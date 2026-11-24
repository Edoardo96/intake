import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { addPlanMeal, mealPlanSchema, removePlanMeal, restorePlanMeal, type MealPlan } from "../src/index.js";

const plan: MealPlan = mealPlanSchema.parse(JSON.parse(readFileSync(new URL("../../../examples/meal-plan.example.json", import.meta.url), "utf8")));
const titles = (p: MealPlan, day: keyof MealPlan["days"]) => p.days[day].meals.map((m) => `${m.title} ${m.time ?? ""}`.trim());

describe("plan meals", () => {
  it("takes the morning snack out of one day, keeping it to put back", () => {
    const { plan: next, maps } = removePlanMeal(plan, { day: "monday", index: 1, allDays: false });
    expect(titles(next, "monday")).toEqual(["Colazione", "Pranzo", "Spuntino 16:00", "Cena"]);
    expect(next.days.monday.removed![0]).toMatchObject({ title: "Spuntino", time: "11:00" });
    expect(next.days.tuesday.meals).toEqual(plan.days.tuesday.meals);
    expect(maps).toEqual({ monday: [0, null, 1, 2, 3] });
  });

  it("takes the same slot out of every day (the first Spuntino, not the afternoon one) and puts it back everywhere", () => {
    const { plan: next, maps } = removePlanMeal(plan, { day: "monday", index: 1, allDays: true });
    for (const day of ["monday", "wednesday"] as const) expect(titles(next, day).filter((t) => t.startsWith("Spuntino"))).toHaveLength(1);
    expect(Object.keys(maps)).toHaveLength(7);
    const { plan: back, maps: backMaps } = restorePlanMeal(next, { day: "monday", removed: 0, allDays: true });
    expect(titles(back, "monday")).toEqual(titles(plan, "monday"));
    expect(back.days.monday.removed).toBeUndefined();
    expect(backMaps.monday).toEqual([0, 2, 3, 4]);
  });

  it("adds a new meal at its time", () => {
    const { plan: next } = addPlanMeal(plan, { day: "friday", allDays: false, title: "Merenda", time: "17:30", type: "snack", description: "Yogurt", foods: [{ name: "Yogurt", quantity: 150, unit: "g", nutrients: { kcal: 90, protein: 15, carbs: 6, fat: 0, fiber: 0 } }] });
    const list = titles(next, "friday");
    expect(list.indexOf("Merenda 17:30")).toBe(list.length - 2);
  });
});
