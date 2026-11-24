import { describe, expect, it } from "vitest";
import { addCourse, editMeal, mealPlanSchema, normalizeCourses, removeCourse, type MealPlan } from "../src/index.js";
import { readFileSync } from "node:fs";

const plan: MealPlan = mealPlanSchema.parse(JSON.parse(readFileSync(new URL("../../../examples/meal-plan.example.json", import.meta.url), "utf8")));
const yogurt = { name: "Yogurt greco", quantity: 150, unit: "g", nutrients: { kcal: 90, protein: 15, carbs: 6, fat: 0, fiber: 0 } };

describe("courses", () => {
  const index = plan.days.wednesday.meals.findIndex((m) => m.title === "Pranzo");

  it("adds a course, keeping the dish as the first one, with foods and macros of both", () => {
    const before = plan.days.wednesday.meals[index]!;
    const next = addCourse(plan, { day: "wednesday", index, name: "Fine pasto", firstName: "Primo", description: "Yogurt greco", foods: [yogurt] });
    const meal = next.days.wednesday.meals[index]!;
    if (meal.free) throw new Error("free");
    expect(meal.courses!.map((c) => c.name)).toEqual(["Primo", "Fine pasto"]);
    expect(meal.foods.at(-1)!.name).toBe("Yogurt greco");
    expect(meal.foods).toHaveLength(("foods" in before ? before.foods.length : 0) + 1);
    if (!before.free && before.macros) expect(meal.macros!.kcal).toBe(before.macros.kcal + 90);
    expect(meal.description).toContain(" + Yogurt greco");
  });

  it("edits one course only, and removing one leaves a single dish", () => {
    const two = addCourse(plan, { day: "wednesday", index, name: "Fine pasto", description: "Yogurt greco", foods: [yogurt] });
    const edited = editMeal(two, { day: "wednesday", index, course: 1, description: "Frutta", foods: [{ name: "Mela", quantity: 150, unit: "g", nutrients: { kcal: 78, protein: 0.4, carbs: 21, fat: 0.3, fiber: 3.6 } }] });
    const meal = edited.days.wednesday.meals[index]!;
    if (meal.free) throw new Error("free");
    expect(meal.courses![1]).toMatchObject({ name: "Fine pasto", description: "Frutta" });
    expect(meal.courses![0]).toEqual(two.days.wednesday.meals[index]!.free ? undefined : (two.days.wednesday.meals[index] as { courses: unknown[] }).courses[0]);
    const one = removeCourse(edited, { day: "wednesday", index, course: 1 });
    const single = one.days.wednesday.meals[index]!;
    expect("courses" in single && single.courses).toBeFalsy();
    expect(() => removeCourse(one, { day: "wednesday", index, course: 0 })).toThrow();
  });

  it("recomputes foods and macros of an uploaded meal from its courses", () => {
    const meal = { title: "Pranzo", foods: [{ name: "x" }], courses: [
      { name: "Primo", foods: [{ name: "Pasta", nutrients: { kcal: 350, protein: 12, carbs: 70, fat: 2, fiber: 3 } }] },
      { name: "Fine pasto", foods: [yogurt] },
    ] };
    const uploaded = mealPlanSchema.parse({ ...plan, days: { ...plan.days, monday: { meals: [meal] } } });
    const fixed = normalizeCourses(uploaded).days.monday.meals[0]!;
    if (fixed.free) throw new Error("free");
    expect(fixed.foods.map((f) => f.name)).toEqual(["Pasta", "Yogurt greco"]);
    expect(fixed.macros?.kcal).toBe(440);
  });
});
