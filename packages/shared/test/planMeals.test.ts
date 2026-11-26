import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { addPlanMeal, mealPlanSchema, removePlanMeal, type MealPlan } from "../src/index.js";

const plan: MealPlan = mealPlanSchema.parse(JSON.parse(readFileSync(new URL("../../../examples/meal-plan.example.json", import.meta.url), "utf8")));
const titles = (p: MealPlan, day: keyof MealPlan["days"]) => p.days[day].meals.map((m) => `${m.title} ${m.time ?? ""}`.trim());

describe("plan meals", () => {
  it("takes the morning snack out of one day", () => {
    const { plan: next, maps } = removePlanMeal(plan, { day: "monday", index: 1, allDays: false });
    expect(titles(next, "monday")).toEqual(["Colazione", "Pranzo", "Spuntino 16:00", "Cena"]);
    expect(next.days.monday.removed).toBeUndefined();
    expect(next.days.tuesday.meals).toEqual(plan.days.tuesday.meals);
    expect(maps).toEqual({ monday: [0, null, 1, 2, 3] });
  });

  it("takes the same slot out of every day (the first Spuntino, not the afternoon one)", () => {
    const { plan: next, maps } = removePlanMeal(plan, { day: "monday", index: 1, allDays: true });
    for (const day of ["monday", "wednesday"] as const) expect(titles(next, day).filter((t) => t.startsWith("Spuntino"))).toHaveLength(1);
    expect(titles(next, "wednesday")).toContain("Spuntino dolce 16:00");
    expect(Object.keys(maps)).toHaveLength(7);
  });

  it("adds a new meal at its time", () => {
    const { plan: next } = addPlanMeal(plan, { day: "friday", allDays: false, title: "Merenda", time: "17:30", type: "snack", description: "Yogurt", foods: [{ name: "Yogurt", quantity: 150, unit: "g", nutrients: { kcal: 90, protein: 15, carbs: 6, fat: 0, fiber: 0 } }] });
    const list = titles(next, "friday");
    expect(list.indexOf("Merenda 17:30")).toBe(list.length - 2);
  });
});

describe("plan dishes", () => {
  it("lists one dish per name without amounts, each course as its own dish, with a category", async () => {
    const { planDishes, splitMeal, looseDishKey } = await import("../src/index.js");
    expect(looseDishKey("Pasta 80 g + Pomodoro 100 g")).toBe(looseDishKey("Pasta + Pomodoro"));
    const index = plan.days.wednesday.meals.findIndex((m) => m.title === "Pranzo");
    const n = (kcal: number) => ({ kcal, protein: 5, carbs: 10, fat: 2, fiber: 1 });
    const lunch = { title: "Pranzo", foods: [{ name: "Pasta", quantity: 80, unit: "g", nutrients: n(280) }, { name: "Zucchine", quantity: 150, unit: "g", nutrients: n(30) }] };
    const withLunch = mealPlanSchema.parse({ ...plan, days: { ...plan.days, wednesday: { ...plan.days.wednesday, meals: plan.days.wednesday.meals.map((m, i) => (i === index ? lunch : m)) } } });
    const split = splitMeal(withLunch, { day: "wednesday", index, labels: ["Primo", "Contorno"] });
    const dishes = planDishes(split);
    expect(new Set(dishes.map((d) => d.key)).size).toBe(dishes.length);
    expect(dishes.find((d) => d.name === "Pasta")?.category).toBe("first");
    expect(dishes.find((d) => d.name === "Zucchine")?.category).toBe("side");
    expect(dishes.every((d) => d.foods.length > 0 && (d.totals || d.foods.every((f) => f.nutrients)))).toBe(true);
  });
});

describe("similar dishes", () => {
  it("finds a dish with most words or foods in common, not one that only shares a small word", async () => {
    const { similarDishes } = await import("../src/index.js");
    const dish = (name: string, foods: string[]) => ({ name, description: "", items: foods.map((name) => ({ name })) });
    const list = [dish("Insalata di riso tonno e mozzarella", ["Riso", "Tonno"]), dish("Pasta al pomodoro", ["Pasta", "Passata"]), dish("Riso freddo", ["Riso", "Tonno", "Pomodori", "Mozzarella"])];
    const found = similarDishes({ name: "Insalata di riso con tonno, pomodori e mozzarella", foods: ["Riso", "Tonno", "Pomodori", "Mozzarella", "Olio"].map((name) => ({ name })) }, list);
    expect(found.map((f) => f.dish.name).sort()).toEqual(["Insalata di riso tonno e mozzarella", "Riso freddo"]);
    expect(similarDishes({ name: "Pasta e fagioli", foods: [{ name: "Pasta" }] }, [dish("Pasta al salmone", ["Pasta", "Salmone"])])).toEqual([]);
  });
});
