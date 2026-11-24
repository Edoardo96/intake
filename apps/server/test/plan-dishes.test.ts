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
    const api = { savedMeals: vi.fn(async () => [{ id: "x", name: already.name.toUpperCase() } as never]), createSavedMeal };
    const setCategory = vi.fn();
    const sleep = vi.fn(async () => {});
    const saver = new PlanDishSaver(api, { setCategory }, { info: () => {}, warn: () => {} }, sleep);
    expect(await saver.saveAll(plan)).toBe(all.length - 1);
    await saver.idle();
    const names = createSavedMeal.mock.calls.map(([f]) => f.name);
    expect(names).not.toContain(already.name);
    expect(new Set(names).size).toBe(all.length - 1);
    expect(sleep).toHaveBeenCalledWith(5000);
    expect(setCategory).toHaveBeenCalledTimes(all.length - 1);
  });
});
