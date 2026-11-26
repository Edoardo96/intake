import { readFileSync } from "node:fs";
import { mealPlanSchema, planDishes, type MealPlan } from "@intake/shared";
import { describe, expect, it, vi } from "vitest";
import { PlanDishSaver } from "../src/services/planDishSaver.js";
import { RateLimitedError } from "../src/mcp/connection.js";

const plan: MealPlan = mealPlanSchema.parse(JSON.parse(readFileSync(new URL("../../../examples/meal-plan.example.json", import.meta.url), "utf8")));

describe("PlanDishSaver", () => {
  it("saves only the plan's dishes not yet in Piatti, with their category, waiting between writes and after a rate limit", async () => {
    const all = planDishes(plan);
    expect(all.length).toBeGreaterThan(2);
    const already = all[0]!;
    let calls = 0;
    const createSavedMeal = vi.fn(async (_fields: { name: string }) => {
      calls++;
      if (calls === 1) throw new RateLimitedError(5);
      return { id: `id-${calls}` };
    });
    const saved = { id: "x", name: already.name.toUpperCase(), description: "", mealType: null, kcal: 300, protein: 10, carbs: 30, fat: 5, items: [] };
    const api = { savedMeals: vi.fn(async () => [saved]), createSavedMeal };
    const setCategory = vi.fn();
    const sleep = vi.fn(async () => {});
    const saver = new PlanDishSaver(api, { setCategory, all: () => new Map() }, { info: () => {}, warn: () => {} }, sleep);
    const { saving, similar } = await saver.saveAll(plan);
    expect(saving + similar).toBe(all.length - 1);
    expect(saving).toBeGreaterThan(0);
    await saver.idle();
    const names = createSavedMeal.mock.calls.map(([f]) => f.name);
    expect(names).not.toContain(already.name);
    expect(new Set(names).size).toBe(saving);
    expect(sleep).toHaveBeenCalledWith(5000);
    expect(setCategory).toHaveBeenCalledTimes(saving);
  });
});

describe("saving a planned dish", () => {
  it("sends sugar only together with added sugar (Nutrition refuses one without the other)", async () => {
    const { planDishWrite } = await import("@intake/shared");
    const { savedMealFields } = await import("../src/routes/dishes.js");
    const { itemsAllOrNone } = await import("../src/services/mealWrites.js");
    const n = { kcal: 100, protein: 5, carbs: 10, fat: 2, fiber: 1, sugar: 3, addedSugar: 1 };
    const write = planDishWrite({ title: "Pranzo", foods: [{ name: "Riso", quantity: 80, unit: "g", nutrients: n }, { name: "Tonno", quantity: 120, unit: "g", nutrients: n }] })!;
    const { key: _key, ...dish } = write;
    const items = savedMealFields(dish).items as Array<Record<string, unknown>>;
    expect(items.every((i) => "sugar_g" in i && "added_sugar_g" in i)).toBe(true);
    expect(itemsAllOrNone([{ name: "a", sugar_g: 1 }, { name: "b", sugar_g: 2 }])).toEqual([{ name: "a" }, { name: "b" }]);
  });
});
