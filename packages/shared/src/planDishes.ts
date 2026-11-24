/**
 * The dishes of the meal plan as dishes of Piano › Piatti (Nutrition saved meals), saved only when the person asks
 * ("Salva nei tuoi piatti" on one dish, "Salva tutti i piatti del piano"). One dish per name: the same dish with other
 * grams on another day is the same dish. Each course of a meal is a dish of its own. Rules in docs/plan-dishes.md.
 */
import type { BuiltInDishCategory, DishWrite } from "./dishes.js";
import { looseDishKey } from "./dishGroups.js";
import { WEEKDAYS, type Course, type FixedPlannedMeal, type MealPlan, type PlannedMacros } from "./mealPlan.js";
import type { NUTRITION_MEAL_TYPES } from "./nutrition.js";
import { isFixedMeal, mealTypeOf } from "./planUtils.js";
import { courseMacros } from "./courses.js";

/** The name of a planned dish: its description, or its foods without amounts ("Pasta + Pomodoro"). */
export function planDishName(dish: Pick<Course, "description" | "foods">): string {
  return (dish.description?.trim() || dish.foods.map((f) => f.name).join(" + ")).slice(0, 100);
}

const COURSE_CATEGORIES: Record<string, BuiltInDishCategory | null> = {
  antipasto: null,
  primo: "first",
  secondo: "main",
  contorno: "side",
  frutta: "snack",
  dolce: "dessert",
  "fine pasto": "snack",
  bevanda: null,
};

export interface PlanDish extends DishWrite {
  /** looseDishKey of the name: the same dish across days, plans and the saved meals. */
  key: string;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function totalsOf(macros: PlannedMacros): NonNullable<DishWrite["totals"]> {
  return {
    kcal: Math.min(5000, Math.round(macros.kcal)),
    protein: round1(macros.protein),
    carbs: round1(macros.carbs),
    fat: round1(macros.fat),
    fiber: round1(macros.fiber),
    ...(macros.sugar !== undefined && macros.addedSugar !== undefined ? { sugar: round1(macros.sugar), addedSugar: Math.min(round1(macros.addedSugar), round1(macros.sugar)) } : {}),
  };
}

/** The dish categories of a planned dish: its course, else its meal type. */
export function planDishCategory(meal: FixedPlannedMeal, course?: Pick<Course, "name">): string | null {
  if (course) return COURSE_CATEGORIES[course.name.trim().toLowerCase()] ?? null;
  const type = mealTypeOf(meal);
  return type === "breakfast" ? "breakfast" : type === "snack" ? "snack" : "single";
}

/**
 * A planned dish (a meal without courses, or one course) as a dish of Piatti; null when it has no values at all (a
 * saved meal needs them) or too many foods.
 */
export function planDishWrite(meal: FixedPlannedMeal, course?: Course): PlanDish | null {
  const dish: Pick<Course, "description" | "foods" | "macros"> = course ?? meal;
  const name = planDishName(dish);
  const key = looseDishKey(name);
  if (!key || dish.foods.length === 0 || dish.foods.length > 30) return null;
  const withValues = dish.foods.every((f) => f.nutrients);
  const macros = withValues ? null : (courseMacros(dish) ?? null);
  if (!withValues && !macros) return null;
  const foods = dish.foods.map((f) => ({
    name: f.name.slice(0, 80),
    ...(f.quantity !== undefined ? { quantity: f.quantity } : {}),
    ...(f.unit ? { unit: f.unit.slice(0, 12) } : {}),
    // Sugar and added sugar travel together: Nutrition refuses sugar without added sugar
    ...(withValues && f.nutrients ? { nutrients: { kcal: f.nutrients.kcal, protein: f.nutrients.protein, carbs: f.nutrients.carbs, fat: f.nutrients.fat, fiber: f.nutrients.fiber, ...(f.nutrients.sugar !== undefined && f.nutrients.addedSugar !== undefined ? { sugar: f.nutrients.sugar, addedSugar: f.nutrients.addedSugar } : {}) } } : {}),
  }));
  const mealType: (typeof NUTRITION_MEAL_TYPES)[number] = mealTypeOf(meal);
  return { key, name, category: planDishCategory(meal, course), mealType, foods, ...(macros ? { totals: totalsOf(macros) } : {}) };
}

/** The distinct dishes of a plan with values, one per name without amounts (the first one found is kept). */
export function planDishes(plan: MealPlan): PlanDish[] {
  const found = new Map<string, PlanDish>();
  for (const day of WEEKDAYS) {
    for (const meal of plan.days[day].meals) {
      if (!isFixedMeal(meal) || meal.foods.length === 0) continue;
      for (const course of meal.courses ?? [undefined]) {
        const dish = planDishWrite(meal, course);
        if (dish && !found.has(dish.key)) found.set(dish.key, dish);
      }
    }
  }
  return [...found.values()];
}

const STOP_WORDS = new Set(["di", "del", "della", "dello", "dei", "degli", "delle", "con", "e", "ed", "al", "allo", "alla", "ai", "agli", "alle", "a", "da", "in", "il", "lo", "la", "i", "gli", "le", "un", "uno", "una", "per", "su", "senza", "the", "and", "with", "of", "en", "met", "van", "de", "het"]);

function words(text: string): Set<string> {
  return new Set(looseDishKey(text).split(" ").filter((w) => w.length > 1 && !STOP_WORDS.has(w)));
}

function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared / (a.size + b.size - shared);
}

export interface SimilarDish<T> {
  dish: T;
  /** 0–1: how alike the names or the foods are. */
  score: number;
}

/** Minimum likeness to ask "Unisci o nuovo?": half the meaningful words, or half the foods, in common. */
export const SIMILAR_DISH_SCORE = 0.5;

/**
 * Dishes of Piatti that look like a dish about to be saved: by the words of the names (without amounts and small
 * words) and by the foods. The same name without amounts is not "similar", it is the dish itself (looseDishKey).
 * Best first, at most `limit`.
 */
export function similarDishes<T extends { name: string; description: string; aliases?: string[]; items: Array<{ name: string }> }>(
  target: { name: string; foods: Array<{ name: string }> },
  dishes: T[],
  limit = 3,
): Array<SimilarDish<T>> {
  const name = words(target.name);
  const foods = new Set(target.foods.map((f) => looseDishKey(f.name)).filter(Boolean));
  return dishes
    .map((dish) => {
      const names = [dish.name, ...(dish.aliases ?? [])].map(words);
      const nameScore = Math.max(...names.map((n) => overlap(name, n)));
      const dishFoods = new Set(dish.items.map((i) => looseDishKey(i.name)).filter(Boolean));
      const foodScore = foods.size >= 2 && dishFoods.size >= 2 ? overlap(foods, dishFoods) : 0;
      return { dish, score: Math.round(Math.max(nameScore, foodScore) * 100) / 100 };
    })
    .filter((s) => s.score >= SIMILAR_DISH_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
