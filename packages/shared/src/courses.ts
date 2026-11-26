import { foodLine, isFixedMeal } from "./planUtils.js";
import { sumFoodNutrients } from "./planGeneration.js";
import type { Course, FixedPlannedMeal, MealPlan, PlannedFood, PlannedMacros, PlannedMeal } from "./mealPlan.js";
import { WEEKDAYS } from "./mealPlan.js";

/**
 * Courses (portate) of a planned meal: a lunch with a primo and a yogurt is one meal with two courses, each with its
 * foods, values and interchangeable dishes. The meal's own foods and macros are always those of all its courses
 * together, so everything that reads a meal as one dish (shopping list, PDF, logging, totals) keeps working.
 * Rules in docs/courses.md.
 */

export const COURSE_NAMES = ["Antipasto", "Primo", "Secondo", "Contorno", "Frutta", "Dolce", "Fine pasto", "Bevanda"] as const;
export const COURSES_MAX = 6;

/**
 * The courses of a logged meal (Nuovo pasto / Modifica pasto): Nutrition keeps only the foods, in order, so Intake keeps
 * which consecutive foods make each course. Ignored when the counts no longer add up to the meal's foods.
 */
export interface MealCourse {
  name: string;
  count: number;
}

export const MEAL_COURSES_MAX = 8;

/** The meal's foods split into its courses, or null when there are none or they no longer match the foods. */
export function splitIntoCourses<T>(items: T[], courses: MealCourse[] | null | undefined): Array<{ name: string; items: T[] }> | null {
  if (!courses || courses.length < 2 || courses.reduce((s, c) => s + c.count, 0) !== items.length) return null;
  let start = 0;
  return courses.map((c) => {
    const part = items.slice(start, start + c.count);
    start += c.count;
    return { name: c.name, items: part };
  });
}

/** The text of a course, as a dish: its description or its foods. */
export function courseText(course: Pick<Course, "description" | "foods">): string {
  return course.description ?? course.foods.map(foodLine).join(" + ");
}

/** The courses of a fixed meal; a meal without courses is one unnamed course. */
export function coursesOf(meal: FixedPlannedMeal): Course[] {
  if (meal.courses && meal.courses.length > 0) return meal.courses;
  return [{ name: "", ...(meal.description ? { description: meal.description } : {}), foods: meal.foods, ...(meal.macros ? { macros: meal.macros } : {}) }];
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** A course's nutrients: its own, or the sum of its foods' values. */
export function courseMacros(course: Pick<Course, "foods" | "macros">): PlannedMacros | null {
  return course.macros ?? sumFoodNutrients(course.foods);
}

/** Sum of the courses' nutrients; null when any course has none. Optional nutrients only when every course has them. */
export function sumCourseMacros(courses: Array<Pick<Course, "foods" | "macros">>): PlannedMacros | null {
  const all = courses.map(courseMacros);
  if (all.length === 0 || all.some((m) => !m)) return null;
  const list = all as PlannedMacros[];
  const total: PlannedMacros = {
    kcal: Math.round(list.reduce((s, m) => s + m.kcal, 0)),
    protein: round1(list.reduce((s, m) => s + m.protein, 0)),
    carbs: round1(list.reduce((s, m) => s + m.carbs, 0)),
    fat: round1(list.reduce((s, m) => s + m.fat, 0)),
    fiber: round1(list.reduce((s, m) => s + m.fiber, 0)),
  };
  if (list.every((m) => m.sugar !== undefined && m.addedSugar !== undefined)) {
    total.sugar = round1(list.reduce((s, m) => s + m.sugar!, 0));
    total.addedSugar = Math.min(round1(list.reduce((s, m) => s + m.addedSugar!, 0)), total.sugar);
  }
  if (list.every((m) => m.saturatedFat !== undefined)) total.saturatedFat = Math.min(round1(list.reduce((s, m) => s + m.saturatedFat!, 0)), total.fat);
  return total;
}

/**
 * A fixed meal with these courses: the foods of all courses in order, the description "A + B" and the summed macros.
 * One course left makes it a meal without courses again.
 */
export function withCourses(meal: Pick<FixedPlannedMeal, "title" | "time" | "type">, courses: Course[], fallback?: PlannedMacros): FixedPlannedMeal {
  const base = { title: meal.title, ...(meal.time !== undefined ? { time: meal.time } : {}), ...(meal.type !== undefined ? { type: meal.type } : {}) };
  if (courses.length === 1) {
    const [only] = courses;
    return { ...base, ...(only!.description ? { description: only!.description } : {}), foods: only!.foods, ...(only!.macros ? { macros: only!.macros } : {}) };
  }
  // A meal split into courses whose foods have no values of their own keeps the totals it had (from a plan file)
  const macros = sumCourseMacros(courses) ?? fallback ?? null;
  return {
    ...base,
    description: courses.map(courseText).join(" + ").slice(0, 300),
    foods: courses.flatMap((c) => c.foods),
    ...(macros ? { macros } : {}),
    courses,
  };
}

/** A plan whose meals with courses have their foods, description and macros recomputed from them (on upload). */
export function normalizeCourses(plan: MealPlan): MealPlan {
  const days = Object.fromEntries(
    WEEKDAYS.map((w) => [w, { ...plan.days[w], meals: plan.days[w].meals.map((m: PlannedMeal) => (isFixedMeal(m) && m.courses ? withCourses(m, m.courses, m.macros) : m)) }]),
  ) as MealPlan["days"];
  return { ...plan, days };
}

/**
 * Foods with the name of their course (from a plan file, the AI or "Dividi in portate") grouped into courses, in the
 * order each name first appears. A food without a name joins the course before it (the first one at the start). Null
 * when there are fewer than two courses: the meal stays one dish.
 */
export function coursesFromLabels(foods: PlannedFood[], labels: Array<string | null | undefined>): Course[] | null {
  const order: string[] = [];
  const byName = new Map<string, PlannedFood[]>();
  let last: string | undefined;
  const firstNamed = labels.map((l) => l?.trim()).find((l) => l);
  foods.forEach((food, i) => {
    const name = labels[i]?.trim().slice(0, 30) || last || firstNamed;
    if (!name) return;
    const key = name.toLowerCase();
    if (!byName.has(key)) {
      order.push(name);
      byName.set(key, []);
    }
    byName.get(key)!.push(food);
    last = name;
  });
  if (order.length < 2 || order.length > COURSES_MAX) return null;
  return order.map((name) => ({ name, foods: byName.get(name.toLowerCase())! }));
}

/**
 * The meal with new values for its foods ("Dividi in alimenti con l'IA", one meal or the whole week). A meal of courses
 * keeps its foods as the courses' foods one after the other, so the values go back to each course; its totals stay.
 */
export function withFoodValues<M extends FixedPlannedMeal>(meal: M, foods: PlannedFood[]): FixedPlannedMeal {
  if (!meal.courses) return { ...meal, foods };
  let at = 0;
  const courses = meal.courses.map((course) => {
    const own = foods.slice(at, at + course.foods.length);
    at += course.foods.length;
    const { macros: _old, ...rest } = course;
    // The course's own totals stay only while some of its foods still have no values
    return own.every((f) => f.nutrients) ? { ...rest, foods: own } : { ...course, foods: own };
  });
  return withCourses(meal, courses, meal.macros);
}
