import type { DishSummary, MealItem, Nutrients, PlannedFood, RecognizedItem } from "@intake/shared";
import type { ManualFood } from "../components/MealCourseSheet";

/**
 * "Altro…" on a course of a planned meal (Timeline, Oggi; docs/courses.md): what was eaten in its place, as foods with
 * their values, from a photo or a description (AI), from your dishes or typed by hand.
 */
export interface OtherCourse {
  name: string;
  foods: Array<PlannedFood & { nutrients: NonNullable<PlannedFood["nutrients"]> }>;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Values of a food at its amount; sugar and added sugar only together (Nutrition refuses one alone). */
function values(n: { kcal: number; protein: number; carbs: number; fat: number; fiber?: number | null; sugar?: number | null; addedSugar?: number | null }, factor = 1) {
  const sugar = n.sugar ?? null;
  const added = n.addedSugar ?? null;
  return {
    kcal: Math.round(n.kcal * factor),
    protein: r1(n.protein * factor),
    carbs: r1(n.carbs * factor),
    fat: r1(n.fat * factor),
    fiber: r1((n.fiber ?? 0) * factor),
    ...(sugar !== null && added !== null ? { sugar: r1(sugar * factor), addedSugar: r1(Math.min(added, sugar) * factor) } : {}),
  };
}

export function otherFromRecognized(description: string, items: RecognizedItem[]): OtherCourse | null {
  const foods = items.map((item) => ({ name: item.name.slice(0, 200), quantity: item.grams, unit: "g", nutrients: values(item.per100g, item.grams / 100) }));
  return foods.length > 0 ? { name: (description || foods.map((f) => f.name).join(", ")).slice(0, 200), foods: foods.slice(0, 20) } : null;
}

export function otherFromDish(dish: DishSummary): OtherCourse | null {
  const foods = dish.items
    .filter((item: MealItem) => item.nutrients)
    .map((item: MealItem) => ({ name: item.name.slice(0, 200), ...(item.quantity !== null ? { quantity: item.quantity } : {}), ...(item.unit ? { unit: item.unit } : {}), nutrients: values(item.nutrients as Nutrients) }));
  if (foods.length > 0 && foods.length === dish.items.length) return { name: dish.name, foods: foods.slice(0, 20) };
  if (dish.kcal === null) return null;
  return { name: dish.name, foods: [{ name: dish.name.slice(0, 200), nutrients: values({ kcal: dish.kcal, protein: dish.protein ?? 0, carbs: dish.carbs ?? 0, fat: dish.fat ?? 0 }) }] };
}

export function otherFromManual(food: ManualFood): OtherCourse {
  return { name: food.name, foods: [{ name: food.name.slice(0, 200), quantity: food.amount, unit: food.unit, nutrients: values(food) }] };
}

export const otherKcal = (other: OtherCourse) => other.foods.reduce((sum, f) => sum + f.nutrients.kcal, 0);
