import {
  courseMacros,
  courseText,
  sumCourseMacros,
  dishKey,
  dishKeys,
  dishMacros,
  isFixedMeal,
  mealFoodsText,
  mealTimes,
  mealTypeOf,
  planDay,
  type DishGroup,
  type PlannedFood,
  type PlannedMacros,
} from "@intake/shared";
import type { PlanStore } from "../db/planStore.js";
import type { MealWriteFields, NutritionApi } from "../mcp/nutritionApi.js";
import { itemFields, itemsAllOrNone } from "./mealWrites.js";

export class PlanMealNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanMealNotFoundError";
  }
}

/** The planned meal has no nutrients, so logging it would store a meal without values. */
export class PlanMealWithoutMacrosError extends Error {
  constructor() {
    super("The planned meal has no nutrients to log");
    this.name = "PlanMealWithoutMacrosError";
  }
}

/**
 * Items for log_meal when every planned food carries its own nutrients: each food is logged with its amount and values,
 * so the meal keeps its foods and they can be edited later. Null when any food lacks them (the meal is logged as a total).
 */
export function plannedItems(foods: PlannedFood[]): Array<Record<string, unknown>> | null {
  if (foods.length === 0 || foods.some((f) => !f.nutrients)) return null;
  const items = foods.map((f) => {
    const n = f.nutrients!;
    return itemFields({
      name: f.name,
      quantity: f.quantity ?? null,
      unit: f.unit ?? null,
      nutrients: {
        kcal: n.kcal,
        protein: n.protein,
        carbs: n.carbs,
        fat: n.fat,
        saturatedFat: null,
        transFat: null,
        fiber: n.fiber,
        sugar: n.sugar ?? null,
        addedSugar: n.addedSugar ?? null,
        alcohol: null,
        caffeineMg: null,
        sodiumMg: null,
      },
    });
  });
  return itemsAllOrNone(items);
}

/** Planned nutrients → log_meal fields (optional ones only when the plan has them). */
export function macrosToFields(macros: PlannedMacros): MealWriteFields {
  const fields: MealWriteFields = {
    calories: macros.kcal,
    protein_g: macros.protein,
    carbs_g: macros.carbs,
    fat_g: macros.fat,
    fiber_g: macros.fiber,
  };
  if (macros.sugar !== undefined) fields.sugar_g = macros.sugar;
  if (macros.addedSugar !== undefined) fields.added_sugar_g = macros.addedSugar;
  if (macros.saturatedFat !== undefined) fields.saturated_fat_g = macros.saturatedFat;
  if (macros.sodiumMg !== undefined) fields.sodium_mg = macros.sodiumMg;
  if (macros.caffeineMg !== undefined) fields.caffeine_mg = macros.caffeineMg;
  return fields;
}

export interface LogPlannedInput {
  date: string;
  planId: number;
  index: number;
  today: string;
  now: string;
  /** The interchangeable dish eaten in place of the planned one (Piatti intercambiabili). */
  alternative?: { groupId: number; dishIndex: number };
  /** A meal with courses: what was eaten of each, in order (docs/courses.md); without it, every course as planned. */
  courses?: Array<{ eaten: boolean; alternative?: { groupId: number; dishIndex: number } }>;
}

/** Where the alternative's group comes from; its dish must be in the same group as the planned dish. */
export interface DishGroupSource {
  get(id: number): DishGroup | null;
}

/**
 * "Mangiato come previsto": logs a planned meal with its full planned nutrients and links it.
 * Today it is logged at the current time (Nutrition stamps it when logged_at is left out), whatever the planned time:
 * that is when it was confirmed as eaten. A meal of an earlier day (from the Timeline) keeps its planned time.
 * The idempotency key makes a double tap safe.
 */
export async function logPlannedMeal(
  api: Pick<NutritionApi, "logMeal" | "mealsByDate">,
  plans: Pick<PlanStore, "get" | "addLink">,
  input: LogPlannedInput,
  groups?: DishGroupSource,
): Promise<{ mealId: string | null }> {
  const stored = plans.get(input.planId);
  if (!stored) throw new PlanMealNotFoundError("Plan not found");
  const day = planDay(stored.plan, input.date);
  const meal = day.meals[input.index];
  if (!meal || !isFixedMeal(meal)) throw new PlanMealNotFoundError("Planned meal not found");

  /** The dish of an interchangeable group that may replace `planned` (same group, matched by name). */
  const alternativeOf = (planned: string, choice: { groupId: number; dishIndex: number }) => {
    const group = groups?.get(choice.groupId);
    const dish = group?.dishes[choice.dishIndex];
    if (!group || !dish || !group.dishes.some((d) => dishKeys(d).includes(dishKey(planned)))) throw new PlanMealNotFoundError("Alternative not found");
    return dish;
  };

  // A meal with courses: the courses eaten, each as planned or as one of its interchangeable dishes
  if (meal.courses && input.courses) {
    if (input.courses.length !== meal.courses.length || !input.courses.some((c) => c.eaten)) throw new PlanMealNotFoundError("Invalid courses");
    const eaten = meal.courses.flatMap((course, i) => {
      const choice = input.courses![i]!;
      if (!choice.eaten) return [];
      if (!choice.alternative) return [{ text: courseText(course), foods: course.foods, macros: courseMacros(course) }];
      const dish = alternativeOf(courseText(course), choice.alternative);
      return [{ text: dish.name, foods: dish.foods, macros: dishMacros(dish) }];
    });
    // Courses split from a meal with totals only have no values of their own: the whole meal as planned uses its totals
    const asPlanned = input.courses.every((c) => c.eaten && !c.alternative);
    const total = sumCourseMacros(eaten.map((c) => ({ foods: c.foods, ...(c.macros ? { macros: c.macros } : {}) }))) ?? (asPlanned ? (meal.macros ?? null) : null);
    if (!total) throw new PlanMealWithoutMacrosError();
    const selection = input.courses.map((c) => (!c.eaten ? "x" : c.alternative ? `${c.alternative.groupId}.${c.alternative.dishIndex}` : "p")).join("_");
    return logFoods(eaten.map((c) => c.text).join(" + "), eaten.flatMap((c) => c.foods), total, `intake-plan-${stored.id}-${input.date}-${input.index}-c-${selection}`);
  }

  // The dish to log: the planned one, or an alternative of its group chosen in the Timeline or Oggi
  let name = mealFoodsText(meal);
  let foods = meal.foods;
  let macros: PlannedMacros | null = meal.macros ?? null;
  let key = `intake-plan-${stored.id}-${input.date}-${input.index}`;
  if (input.alternative) {
    const { groupId, dishIndex } = input.alternative;
    const dish = alternativeOf(name, input.alternative);
    name = dish.name;
    foods = dish.foods;
    macros = dishMacros(dish);
    key = `${key}-alt-${groupId}-${dishIndex}`;
  }
  if (!macros) throw new PlanMealWithoutMacrosError();
  return logFoods(name, foods, macros, key);

  async function logFoods(name: string, foods: PlannedFood[], macros: PlannedMacros, key: string): Promise<{ mealId: string | null }> {
  const time = mealTimes(day.meals)[input.index]!;
  const atPlannedTime = input.date < input.today;
  const description = `${meal!.title}: ${name}`;

  // With per-food values the meal keeps its foods in Nutrition; otherwise only its totals are logged
  const items = plannedItems(foods);
  const { id } = await api.logMeal({
    description,
    meal_type: mealTypeOf(meal!),
    ...(items ? { items } : macrosToFields(macros)),
    ...(atPlannedTime ? { logged_at: `${input.date}T${time}` } : {}),
    idempotency_key: key,
  });

  // The response text usually carries the new id; otherwise find the meal we just logged
  let mealId = id;
  if (!mealId) {
    const { meals } = await api.mealsByDate(input.date);
    mealId = meals.find((m) => m.description === description && (!atPlannedTime || m.time === time))?.id ?? null;
  }
  if (mealId) plans.addLink(input.date, stored!.id, input.index, mealId);
  return { mealId };
  }
}
