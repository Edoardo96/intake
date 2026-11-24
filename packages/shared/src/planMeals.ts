/**
 * Meals taken out of the plan and added ("Togli pasto" and "+ Aggiungi pasto" in Piano). A meal taken out is gone; to
 * have it again, "+ Aggiungi pasto" adds it. These changes move the other meals of the day, so each one also returns,
 * per day, where each old position went (null when that meal left): the server moves the links and skips of today to
 * the new positions. Rules in docs/plan-meals.md.
 */
import { z } from "zod";
import { MEAL_TYPES, WEEKDAYS, mealPlanSchema, plannedFoodSchema, type MealPlan, type PlannedMeal, type Weekday } from "./mealPlan.js";
import { mealTimes } from "./planUtils.js";
import { mealEditSchema, sumFoodNutrients } from "./planGeneration.js";

/** For each changed day: the new position of each old one (null when the meal is no longer in the day). */
export type MealIndexMaps = Partial<Record<Weekday, Array<number | null>>>;

export interface PlanMealsChange {
  plan: MealPlan;
  maps: MealIndexMaps;
}

const normal = (title: string) => title.trim().toLowerCase();

/** The same slot on another day: the meal with the same title, counted among the meals with that title ("Spuntino" twice a day). */
function sameSlot(meals: PlannedMeal[], title: string, occurrence: number): number {
  let seen = -1;
  return meals.findIndex((meal) => normal(meal.title) === normal(title) && ++seen === occurrence);
}

function occurrenceOf(meals: PlannedMeal[], index: number): number {
  const title = normal(meals[index]!.title);
  return meals.slice(0, index).filter((meal) => normal(meal.title) === title).length;
}

/** Where a meal at this time goes in the day: before the first meal that comes later. */
function positionFor(meals: PlannedMeal[], time: string): number {
  const times = mealTimes(meals);
  const at = times.findIndex((t) => t > time);
  return at === -1 ? meals.length : at;
}

export const mealRemoveSchema = z.object({ day: z.enum(WEEKDAYS), index: z.number().int().min(0).max(9), allDays: z.boolean() }).strict();
export type MealRemove = z.infer<typeof mealRemoveSchema>;

/** "Togli pasto": the meal out of the day (or out of the same slot of every day). */
export function removePlanMeal(plan: MealPlan, input: MealRemove): PlanMealsChange {
  const meals = plan.days[input.day].meals;
  const chosen = meals[input.index];
  if (!chosen) throw new Error("No such meal");
  const occurrence = occurrenceOf(meals, input.index);
  const days = { ...plan.days };
  const maps: MealIndexMaps = {};
  for (const day of input.allDays ? WEEKDAYS : [input.day]) {
    const list = plan.days[day].meals;
    const at = day === input.day ? input.index : sameSlot(list, chosen.title, occurrence);
    if (at === -1) continue;
    // The meal is gone: "+ Aggiungi pasto" adds one again (a list kept by older versions is dropped too)
    const { removed: _legacy, ...rest } = plan.days[day];
    days[day] = { ...rest, meals: list.filter((_, i) => i !== at) };
    maps[day] = list.map((_, i) => (i === at ? null : i < at ? i : i - 1));
  }
  return { plan: mealPlanSchema.parse({ ...plan, days }), maps };
}

/** "+ Aggiungi pasto": a new meal with its time and dish, on one day or on every day. */
export const mealAddSchema = z
  .object({
    day: z.enum(WEEKDAYS),
    allDays: z.boolean(),
    title: z.string().trim().min(1).max(30),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    type: z.enum(MEAL_TYPES),
    description: z.string().trim().max(200),
    foods: z.array(plannedFoodSchema).min(1).max(20),
    macros: mealEditSchema.shape.macros,
  })
  .strict();
export type MealAdd = z.infer<typeof mealAddSchema>;

export function addPlanMeal(plan: MealPlan, input: MealAdd): PlanMealsChange {
  const summed = sumFoodNutrients(input.foods);
  const m = input.macros;
  const macros = summed ?? (m ? { kcal: Math.round(m.kcal), protein: m.protein, carbs: m.carbs, fat: m.fat, fiber: m.fiber } : null);
  const meal: PlannedMeal = {
    title: input.title,
    time: input.time,
    type: input.type,
    ...(input.description ? { description: input.description } : {}),
    foods: input.foods,
    ...(macros ? { macros } : {}),
  };
  const days = { ...plan.days };
  const maps: MealIndexMaps = {};
  for (const day of input.allDays ? WEEKDAYS : [input.day]) {
    const list = plan.days[day].meals;
    if (list.length >= 10) continue;
    const position = positionFor(list, input.time);
    days[day] = { ...plan.days[day], meals: [...list.slice(0, position), meal, ...list.slice(position)] };
    maps[day] = list.map((_, i) => (i < position ? i : i + 1));
  }
  return { plan: mealPlanSchema.parse({ ...plan, days }), maps };
}
