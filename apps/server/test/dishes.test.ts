import type { SavedMeal } from "@intake/shared";
import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { openDatabase } from "../src/db/database.js";
import { DishStore } from "../src/db/dishStore.js";
import { savedMealFields } from "../src/routes/dishes.js";
import { RecognitionError } from "../src/services/mealRecognition.js";
import { authOptions, signIn } from "./helpers.js";

const ID = "0a9b8c7d-6e5f-4a3b-8c1d-000000000001";
const nutrients = (kcal: number) => ({ kcal, protein: 10, carbs: 20, fat: 5, saturatedFat: null, transFat: null, fiber: 2, sugar: null, addedSugar: null, alcohol: null, caffeineMg: null, sodiumMg: null });
const pasta: SavedMeal = {
  id: ID,
  name: "Pasta con tonno",
  description: "Pasta 100 g + Tonno 80 g",
  mealType: "lunch",
  kcal: 437,
  protein: 30,
  carbs: 70,
  fat: 4,
  items: [
    { name: "Pasta", quantityText: "100 g", quantity: 100, unit: "g", nutrients: nutrients(355) },
    { name: "Tonno", quantityText: "80 g", quantity: 80, unit: "g", nutrients: nutrients(82) },
  ],
};

function setup(recipes?: { writeRecipe: ReturnType<typeof vi.fn> }) {
  let meals: SavedMeal[] = [pasta];
  const api = {
    savedMeals: vi.fn(async () => meals),
    createSavedMeal: vi.fn(async (fields: { name: string }) => {
      const id = "0a9b8c7d-6e5f-4a3b-8c1d-000000000002";
      meals = [...meals, { ...pasta, id, name: fields.name, items: [] }];
      return { id };
    }),
    updateSavedMeal: vi.fn(async () => {}),
    deleteSavedMeal: vi.fn(async (id: string) => {
      const found = meals.some((m) => m.id === id);
      meals = meals.filter((m) => m.id !== id);
      return found;
    }),
  };
  const store = new DishStore(openDatabase(":memory:"));
  return { api, store, app: buildApp({ auth: authOptions(), dishes: { api: api as never, store, ...(recipes ? { recipes: recipes as never } : {}) } }) };
}

describe("dishes", () => {
  it("saves a dish food by food when every food has values, else with its totals", () => {
    const foods = [{ name: "Farro", quantity: 80, unit: "g", nutrients: { kcal: 270, protein: 10, carbs: 54, fat: 2, fiber: 6 } }];
    const byFood = savedMealFields({ name: "Farro", category: null, mealType: null, foods });
    expect(byFood.items).toHaveLength(1);
    expect(byFood.calories).toBeUndefined();
    const byTotals = savedMealFields({ name: "Farro", category: null, mealType: "lunch", foods: [{ name: "Farro", quantity: 80, unit: "g" }], totals: { kcal: 300, protein: 10, carbs: 50, fat: 5, fiber: 6 } });
    expect([byTotals.items, byTotals.calories, byTotals.meal_type, byTotals.description]).toEqual([undefined, 300, "lunch", "Farro 80 g"]);
  });

  it("lists, creates with a category, edits, deletes, and keeps own categories", async () => {
    const { api, store, app } = setup();
    const server = await app;
    expect((await server.inject({ method: "GET", url: "/api/dishes" })).statusCode).toBe(401);
    const headers = { cookie: (await signIn(server)).cookie };
    store.setCategory(ID, "first");
    const list = (await server.inject({ method: "GET", url: "/api/dishes", headers })).json();
    expect(list.dishes.map((d: { name: string; category: string }) => [d.name, d.category])).toEqual([["Pasta con tonno", "first"]]);

    const dish = { name: "Insalata di farro", category: "Estate", foods: [{ name: "Farro", quantity: 80, unit: "g" }], totals: { kcal: 300, protein: 10, carbs: 50, fat: 5, fiber: 6 } };
    expect((await server.inject({ method: "POST", url: "/api/dishes", headers, payload: { ...dish, totals: undefined } })).statusCode).toBe(400);
    expect((await server.inject({ method: "POST", url: "/api/dishes", headers, payload: { ...dish, name: "pasta con TONNO" } })).json()).toEqual({ error: "name_taken" });
    const created = await server.inject({ method: "POST", url: "/api/dishes", headers, payload: dish });
    expect(created.statusCode).toBe(201);
    expect(store.category(created.json().id)).toBe("Estate");
    expect(api.createSavedMeal).toHaveBeenCalledWith(expect.objectContaining({ name: "Insalata di farro", calories: 300 }));

    expect((await server.inject({ method: "PATCH", url: `/api/dishes/${ID}`, headers, payload: { ...dish, name: "Pasta con tonno", category: "first" } })).json()).toEqual({ ok: true });
    expect(api.updateSavedMeal).toHaveBeenCalledWith(ID, expect.not.objectContaining({ name: expect.anything() }));
    expect((await server.inject({ method: "PATCH", url: `/api/dishes/${ID}`, headers, payload: dish })).json()).toEqual({ error: "name_taken" });

    expect((await server.inject({ method: "PUT", url: "/api/dishes/categories", headers, payload: { custom: ["Estate", "Estate", " Cene veloci "] } })).json()).toEqual({ customCategories: ["Estate", "Cene veloci"] });
    expect((await server.inject({ method: "DELETE", url: `/api/dishes/${ID}`, headers })).json()).toEqual({ ok: true });
    expect(store.category(ID)).toBeNull();
    expect((await server.inject({ method: "DELETE", url: `/api/dishes/${ID}`, headers })).statusCode).toBe(404);
  });

  it("asks the recipe once, keeps it, marks it stale when the foods change, and lets the person edit or delete it", async () => {
    const recipe = { minutes: 20, servings: 1, difficulty: "easy", ingredients: ["Pasta 100 g", "Tonno 80 g"], steps: ["Cuoci la pasta.", "Condisci con il tonno."] };
    const writeRecipe = vi.fn(async () => recipe);
    const { api, store, app } = setup({ writeRecipe });
    const server = await app;
    const headers = { cookie: (await signIn(server)).cookie };
    expect((await server.inject({ method: "GET", url: `/api/dishes/${ID}/recipe`, headers })).json()).toEqual({ recipe: null, stale: false });
    const asked = (await server.inject({ method: "POST", url: `/api/dishes/${ID}/recipe/generate`, headers, payload: {} })).json();
    expect([asked.recipe.recipe, asked.recipe.source, asked.stale]).toEqual([recipe, "ai", false]);
    expect(writeRecipe).toHaveBeenCalledWith(expect.objectContaining({ name: "Pasta con tonno", foods: [{ name: "Pasta", quantity: 100, unit: "g" }, { name: "Tonno", quantity: 80, unit: "g" }] }));
    // Reading it again costs nothing
    expect((await server.inject({ method: "GET", url: `/api/dishes/${ID}/recipe`, headers })).json().recipe.recipe).toEqual(recipe);
    expect(writeRecipe).toHaveBeenCalledTimes(1);
    expect(store.all().get(ID)?.hasRecipe).toBe(true);

    api.savedMeals.mockResolvedValue([{ ...pasta, items: [{ ...pasta.items[0]!, quantity: 120, quantityText: "120 g" }] }]);
    expect((await server.inject({ method: "GET", url: `/api/dishes/${ID}/recipe`, headers })).json().stale).toBe(true);

    const edited = (await server.inject({ method: "PUT", url: `/api/dishes/${ID}/recipe`, headers, payload: { ...recipe, minutes: 25 } })).json();
    expect([edited.recipe.recipe.minutes, edited.recipe.source, edited.stale]).toEqual([25, "manual", false]);
    expect((await server.inject({ method: "PUT", url: `/api/dishes/${ID}/recipe`, headers, payload: { ...recipe, steps: [] } })).statusCode).toBe(400);
    expect((await server.inject({ method: "DELETE", url: `/api/dishes/${ID}/recipe`, headers })).json()).toEqual({ recipe: null, stale: false });

    writeRecipe.mockRejectedValueOnce(new RecognitionError("credit", "no credit"));
    expect((await server.inject({ method: "POST", url: `/api/dishes/${ID}/recipe/generate`, headers, payload: {} })).statusCode).toBe(402);
  });

  it("keeps the recipe model, Haiku until changed", async () => {
    const { store, app } = setup({ writeRecipe: vi.fn() });
    const server = await app;
    const headers = { cookie: (await signIn(server)).cookie };
    expect((await server.inject({ method: "GET", url: "/api/dishes/recipe/model", headers })).json().model).toBe("claude-haiku-5-5");
    expect((await server.inject({ method: "PUT", url: "/api/dishes/recipe/model", headers, payload: { model: "gpt" } })).statusCode).toBe(400);
    expect((await server.inject({ method: "PUT", url: "/api/dishes/recipe/model", headers, payload: { model: "claude-sonnet-5-5" } })).json().model).toBe("claude-sonnet-5-5");
    expect(store.recipeModel()).toBe("claude-sonnet-5-5");
  });

  it("answers 503 for the AI recipe without the API key", async () => {
    const { app } = setup();
    const server = await app;
    const headers = { cookie: (await signIn(server)).cookie };
    expect((await server.inject({ method: "POST", url: `/api/dishes/${ID}/recipe/generate`, headers, payload: {} })).statusCode).toBe(503);
  });
});
