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

describe("courses from labels", () => {
  const cf = (items: unknown[], macros?: unknown) => ({
    schema_version: 2,
    updated: "2026-11-23",
    meal_slots: [{ id: "lunch", label: "Pranzo", time: "13:00" }],
    days: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((day) => ({ day, meals: { lunch: { description: "Pasta e yogurt", items, ...(macros ? { macros } : {}) } } })),
  });
  const totals = { kcal: 640, protein_g: 30, carbs_g: 90, fat_g: 15, fiber_g: 6 };

  it("imports a Claude Fitness meal with items' course as courses, keeping the meal's totals", async () => {
    const { importPlan } = await import("../src/index.js");
    const result = importPlan(cf([{ food: "Pasta", quantity: 90, unit: "g", course: "Primo" }, { food: "Pomodoro", quantity: 100, unit: "g", course: "Primo" }, { food: "Yogurt", quantity: 150, unit: "g", course: "Fine pasto" }], totals));
    if (!result.success) throw new Error(JSON.stringify(result.issues));
    const meal = result.plan.days.monday.meals[0]!;
    if (meal.free) throw new Error("free");
    expect(meal.courses!.map((c) => [c.name, c.foods.length])).toEqual([["Primo", 2], ["Fine pasto", 1]]);
    expect(meal.macros!.kcal).toBe(640);
  });

  it("keeps a meal without courses as one dish", async () => {
    const { importPlan } = await import("../src/index.js");
    const result = importPlan(cf([{ food: "Pasta", quantity: 90, unit: "g" }, { food: "Yogurt", quantity: 150, unit: "g" }], totals));
    if (!result.success) throw new Error("invalid");
    const meal = result.plan.days.monday.meals[0]!;
    expect("courses" in meal && meal.courses).toBeFalsy();
  });

  it("splits a planned meal into courses and back into one dish", async () => {
    const { splitMeal } = await import("../src/index.js");
    const index = plan.days.wednesday.meals.findIndex((m) => m.title === "Pranzo");
    const before = plan.days.wednesday.meals[index]!;
    if (before.free) throw new Error("free");
    const labels = before.foods.map((_, i) => (i === before.foods.length - 1 ? "Dolce" : "Primo"));
    const split = splitMeal(plan, { day: "wednesday", index, labels });
    const meal = split.days.wednesday.meals[index]!;
    if (meal.free) throw new Error("free");
    expect(meal.courses!.map((c) => c.name)).toEqual(["Primo", "Dolce"]);
    expect(meal.foods.map((f) => f.name)).toEqual(before.foods.map((f) => f.name));
    expect(meal.macros?.kcal).toBe(before.macros?.kcal);
    const back = splitMeal(split, { day: "wednesday", index, labels: labels.map(() => "Primo") });
    const one = back.days.wednesday.meals[index]!;
    expect("courses" in one && one.courses).toBeFalsy();
  });
});

describe("AI course names", () => {
  it("match COURSE_NAMES", async () => {
    const { COURSE_NAMES, GENERATED_MEAL_JSON_SCHEMA } = await import("../src/index.js");
    expect(JSON.stringify(GENERATED_MEAL_JSON_SCHEMA)).toContain(COURSE_NAMES.join(", "));
  });
});

describe("generated meal with courses", () => {
  it("becomes a meal of courses with summed values", async () => {
    const { toPlannedMeal } = await import("../src/index.js");
    const food = (name: string, kcal: number, course: string) => ({ name, quantity: 100, unit: "g", kcal, protein: 5, carbs: 10, fat: 2, fiber: 1, sugar: 1, addedSugar: 0, course });
    const meal = toPlannedMeal({ slot: "lunch", free: false, description: "Pasta e yogurt", foods: [food("Pasta", 350, "Primo"), food("Yogurt", 90, "Fine pasto")] }, { title: "Pranzo" });
    if (meal.free) throw new Error("free");
    expect(meal.courses!.map((c) => c.name)).toEqual(["Primo", "Fine pasto"]);
    expect(meal.macros!.kcal).toBe(440);
    const one = toPlannedMeal({ slot: "lunch", free: false, description: "Pasta", foods: [food("Pasta", 350, ""), food("Olio", 45, "")] }, { title: "Pranzo" });
    expect("courses" in one && one.courses).toBeFalsy();
  });
});

describe("food values of a meal of courses", () => {
  it("go back to each course, and the meal adds them up", async () => {
    const { withFoodValues, withCourses } = await import("../src/index.js");
    const meal = withCourses({ title: "Pranzo" }, [
      { name: "Primo", foods: [{ name: "Pasta", quantity: 80, unit: "g" }, { name: "Tonno", quantity: 80, unit: "g" }] },
      { name: "Fine pasto", foods: [{ name: "Yogurt", quantity: 150, unit: "g" }] },
    ], { kcal: 640, protein: 40, carbs: 80, fat: 15, fiber: 4 });
    const n = (kcal: number) => ({ kcal, protein: 10, carbs: 20, fat: 5, fiber: 1 });
    const next = withFoodValues(meal, meal.foods.map((f, i) => ({ ...f, nutrients: n([300, 200, 140][i]!) })));
    expect(next.courses!.map((c) => c.foods.map((f) => f.nutrients?.kcal))).toEqual([[300, 200], [140]]);
    expect(next.foods.every((f) => f.nutrients)).toBe(true);
    expect(next.macros!.kcal).toBe(640);
  });
});
