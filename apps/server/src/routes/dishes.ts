import {
  dishCategorySchema,
  dishFoodsKey,
  dishWriteSchema,
  DISH_CUSTOM_CATEGORIES_MAX,
  recipeSchema,
  type DishesResponse,
  type DishWrite,
  type RecipeResponse,
  type SavedMeal,
} from "@intake/shared";
import type { FastifyPluginAsync, FastifyReply, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import type { DishStore } from "../db/dishStore.js";
import type { NutritionApi, SavedMealWriteFields } from "../mcp/nutritionApi.js";
import { RecognitionError } from "../services/mealRecognition.js";
import { macrosToFields, plannedItems } from "../services/logPlanned.js";
import type { PlanGenerator } from "../services/planGenerator.js";

export interface DishRoutesOptions {
  api: Pick<NutritionApi, "savedMeals" | "createSavedMeal" | "updateSavedMeal" | "deleteSavedMeal">;
  store: DishStore;
  /** "Chiedi la ricetta all'IA" (part Pasti da foto); without it the route answers 503. */
  recipes?: Pick<PlanGenerator, "writeRecipe">;
  requireOwner: preHandlerHookHandler;
}

const SAVED_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** save_meal / update_saved_meal fields of a dish: food by food when every food has values, else its totals. */
export function savedMealFields(dish: DishWrite): SavedMealWriteFields {
  const description = dish.foods.map((f) => [f.name, f.quantity, f.unit].filter((v) => v !== undefined && v !== "").join(" ")).join(" + ");
  const base: SavedMealWriteFields = { description: description.slice(0, 500), ...(dish.mealType ? { meal_type: dish.mealType } : {}) };
  const items = dish.totals ? null : plannedItems(dish.foods);
  if (items) return { ...base, items };
  return { ...base, ...macrosToFields(dish.totals!) };
}

/** Piatti under /api/dishes (part Alimentazione; only the AI recipe belongs to Pasti da foto). Rules in docs/dishes.md. */
export const dishRoutes: FastifyPluginAsync<DishRoutesOptions> = async (app, { api, store, recipes, requireOwner }) => {
  app.addHook("preHandler", requireOwner);

  const find = async (id: string): Promise<SavedMeal | null> => (await api.savedMeals()).find((meal) => meal.id === id) ?? null;
  const idOf = (raw: string) => {
    const id = raw.toLowerCase();
    return SAVED_ID.test(id) ? id : null;
  };

  app.get("/dishes", async (): Promise<DishesResponse> => {
    const meta = store.all();
    const dishes = (await api.savedMeals()).map((meal) => ({ ...meal, category: meta.get(meal.id)?.category ?? null, hasRecipe: meta.get(meal.id)?.hasRecipe ?? false }));
    return { dishes, customCategories: store.customCategories() };
  });

  app.post("/dishes", async (request, reply) => {
    const body = dishWriteSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_dish" });
    const exists = (await api.savedMeals()).some((meal) => meal.name.toLowerCase() === body.data.name.toLowerCase());
    if (exists) return reply.code(409).send({ error: "name_taken" });
    let { id } = await api.createSavedMeal({ name: body.data.name, ...savedMealFields(body.data) });
    // The answer usually carries the new id; otherwise find it by its name
    id ??= (await api.savedMeals()).find((meal) => meal.name === body.data.name)?.id ?? null;
    if (id) store.setCategory(id, body.data.category);
    return reply.code(201).send({ id });
  });

  app.patch<{ Params: { id: string } }>("/dishes/:id", async (request, reply) => {
    const id = idOf(request.params.id);
    const body = dishWriteSchema.safeParse(request.body);
    if (!id || !body.success) return reply.code(400).send({ error: "invalid_dish" });
    const meals = await api.savedMeals();
    const current = meals.find((meal) => meal.id === id);
    if (!current) return reply.code(404).send({ error: "Dish not found" });
    const renamed = current.name !== body.data.name;
    if (renamed && meals.some((meal) => meal.id !== id && meal.name.toLowerCase() === body.data.name.toLowerCase())) return reply.code(409).send({ error: "name_taken" });
    await api.updateSavedMeal(id, { ...(renamed ? { name: body.data.name } : {}), ...savedMealFields(body.data) });
    store.setCategory(id, body.data.category);
    return { ok: true };
  });

  // Deleting is confirmed in the app; meals already logged from the dish keep their values
  app.delete<{ Params: { id: string } }>("/dishes/:id", async (request, reply) => {
    const id = idOf(request.params.id);
    if (!id) return reply.code(400).send({ error: "Invalid request" });
    if (!(await api.deleteSavedMeal(id))) return reply.code(404).send({ error: "Dish not found" });
    store.delete(id);
    return { ok: true };
  });

  // The person's own categories ("+ Nuova" in the editor)
  app.put("/dishes/categories", async (request, reply) => {
    const body = z.strictObject({ custom: z.array(dishCategorySchema).max(DISH_CUSTOM_CATEGORIES_MAX) }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "Invalid request" });
    return { customCategories: store.setCustomCategories(body.data.custom) };
  });

  const recipeView = (id: string, meal: SavedMeal): RecipeResponse => {
    const recipe = store.recipe(id);
    return { recipe, stale: recipe !== null && recipe.foodsKey !== dishFoodsKey(meal.items) };
  };

  app.get<{ Params: { id: string } }>("/dishes/:id/recipe", async (request, reply) => {
    const id = idOf(request.params.id);
    const meal = id ? await find(id) : null;
    if (!id || !meal) return reply.code(404).send({ error: "Dish not found" });
    return recipeView(id, meal);
  });

  // "Modifica" of the recipe: kept as the person wrote it
  app.put<{ Params: { id: string } }>("/dishes/:id/recipe", async (request, reply) => {
    const id = idOf(request.params.id);
    const body = recipeSchema.safeParse(request.body);
    if (!id || !body.success) return reply.code(400).send({ error: "invalid_recipe" });
    const meal = await find(id);
    if (!meal) return reply.code(404).send({ error: "Dish not found" });
    store.setRecipe(id, { recipe: body.data, at: new Date().toISOString(), source: "manual", foodsKey: dishFoodsKey(meal.items) });
    return recipeView(id, meal);
  });

  app.delete<{ Params: { id: string } }>("/dishes/:id/recipe", async (request, reply) => {
    const id = idOf(request.params.id);
    if (!id) return reply.code(400).send({ error: "Invalid request" });
    store.setRecipe(id, null);
    return { recipe: null, stale: false } satisfies RecipeResponse;
  });

  const failed = (reply: FastifyReply, error: RecognitionError) =>
    reply.code(error.reason === "credit" ? 402 : error.reason === "busy" ? 503 : error.reason === "refused" ? 422 : 502).send({ error: `recognition_${error.reason}` });

  // "Chiedi la ricetta all'IA" / "Rigenera": one request; the recipe is kept with the dish, so reading it again is free
  app.post<{ Params: { id: string } }>("/dishes/:id/recipe/generate", async (request, reply) => {
    if (!recipes) return reply.code(503).send({ error: "recognition_not_configured" });
    const id = idOf(request.params.id);
    const meal = id ? await find(id) : null;
    if (!id || !meal) return reply.code(404).send({ error: "Dish not found" });
    const note = z.object({ note: z.string().trim().max(200).optional() }).safeParse(request.body ?? {});
    try {
      const recipe = await recipes.writeRecipe({
        name: meal.name,
        foods: meal.items.map((item) => ({ name: item.name, quantity: item.quantity, unit: item.unit })),
        description: meal.description,
        note: note.success ? (note.data.note ?? "") : "",
      });
      store.setRecipe(id, { recipe, at: new Date().toISOString(), source: "ai", foodsKey: dishFoodsKey(meal.items) });
      return recipeView(id, meal);
    } catch (error) {
      if (error instanceof RecognitionError) return failed(reply, error);
      throw error;
    }
  });
};
