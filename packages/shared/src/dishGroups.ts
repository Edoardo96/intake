import { z } from "zod";
import { plannedFoodSchema, plannedMacrosSchema, type FixedPlannedMeal, type PlannedFood, type PlannedMacros } from "./mealPlan.js";
import { mealFoodsText } from "./planUtils.js";

/**
 * Piatti intercambiabili (docs/dish-groups.md): dishes that can take each other's place in any meal of any plan.
 * A group is a set of dishes; wherever the plan has one of them (any day, lunch or dinner) the others are its
 * alternatives, in both directions. Groups are stored per installation, not inside a plan, so they last across
 * new plans. A planned meal belongs to a dish by its name (`mealFoodsText`), compared without case, accents or
 * punctuation; a dish can carry other names ("Collega anche") for plans that call it differently.
 */

export const DISH_GROUP_MAX_DISHES = 8;

export const dishSchema = z.strictObject({
  /** The dish as the plan names it, e.g. "Pasta con tonno". */
  name: z.string().trim().min(1).max(200),
  /** Other names of the same dish in plans ("Pasta al tonno"). */
  aliases: z.array(z.string().trim().min(1).max(200)).max(20).default([]),
  foods: z.array(plannedFoodSchema).min(1).max(20),
  /** The dish's nutrients; without them (and without values on every food) it cannot be logged as eaten. */
  macros: plannedMacrosSchema.nullable().default(null),
});
export type Dish = z.infer<typeof dishSchema>;

export interface DishGroup {
  id: number;
  dishes: Dish[];
}

/** GET /api/dish-groups */
export interface DishGroupsResponse {
  groups: DishGroup[];
}

/** POST /api/dish-groups/link: `alternative` becomes interchangeable with `dish` (groups are merged when needed). */
export const dishLinkSchema = z.strictObject({ dish: dishSchema, alternative: dishSchema });
export type DishLink = z.infer<typeof dishLinkSchema>;

/** PUT /api/dish-groups/:id: the group's dishes after a change (a dish removed, a name linked). */
export const dishGroupUpdateSchema = z.strictObject({ dishes: z.array(dishSchema).min(1).max(DISH_GROUP_MAX_DISHES) });

/** "Pasta con Tonno!" and "pasta con tonno" are the same dish: lower case, no accents, no punctuation, single spaces. */
export function dishKey(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function dishKeys(dish: Pick<Dish, "name" | "aliases">): string[] {
  return [dish.name, ...dish.aliases].map(dishKey).filter(Boolean);
}

const UNITS = new Set(["g", "gr", "kg", "mg", "ml", "cl", "dl", "l", "pz", "pezzo", "pezzi", "fetta", "fette", "cucchiaio", "cucchiai", "cucchiaino", "cucchiaini", "tazza", "tazze", "tazzina", "vasetto", "vasetti", "porzione", "porzioni", "x"]);

/**
 * The key of a dish without its amounts: "Pasta 80 g + Pomodoro 100 g" and "Pasta + Pomodoro" are the same dish (a plan
 * often has one dish with different grams on different days). Numbers, and the unit right after one, are dropped.
 */
export function looseDishKey(text: string): string {
  const words = dishKey(text).split(" ");
  const kept: string[] = [];
  for (let i = 0; i < words.length; i++) {
    if (/^\d+$/.test(words[i]!)) {
      if (UNITS.has(words[i + 1] ?? "")) i++;
      continue;
    }
    kept.push(words[i]!);
  }
  return kept.join(" ");
}

/** The group and the position of the dish called `name`, if any: by its exact name first, then without amounts. */
export function findDish(groups: DishGroup[], name: string): { group: DishGroup; index: number } | null {
  const key = dishKey(name);
  if (!key) return null;
  for (const group of groups) {
    const index = group.dishes.findIndex((dish) => dishKeys(dish).includes(key));
    if (index !== -1) return { group, index };
  }
  const loose = looseDishKey(name);
  if (!loose) return null;
  for (const group of groups) {
    const index = group.dishes.findIndex((dish) => [dish.name, ...dish.aliases].some((n) => looseDishKey(n) === loose));
    if (index !== -1) return { group, index };
  }
  return null;
}

export interface DishAlternative {
  groupId: number;
  /** Position of the dish in its group, used to log it. */
  dishIndex: number;
  dish: Dish;
}

/** The alternatives of a planned dish: the other dishes of its group. */
export function alternativesFor(groups: DishGroup[], name: string): DishAlternative[] {
  const found = findDish(groups, name);
  if (!found) return [];
  return found.group.dishes.flatMap((dish, dishIndex) => (dishIndex === found.index ? [] : [{ groupId: found.group.id, dishIndex, dish }]));
}

/** A planned meal as a dish of a group. */
export function dishOfMeal(meal: FixedPlannedMeal): Dish {
  return { name: mealFoodsText(meal), aliases: [], foods: meal.foods, macros: meal.macros ?? null };
}

/** The nutrients of a dish: its own, or the sum of its foods' when every food has them. */
export function dishMacros(dish: Pick<Dish, "foods" | "macros">): PlannedMacros | null {
  if (dish.macros) return dish.macros;
  if (dish.foods.length === 0 || dish.foods.some((f) => !f.nutrients)) return null;
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const sum = (key: "kcal" | "protein" | "carbs" | "fat" | "fiber") => dish.foods.reduce((s, f) => s + f.nutrients![key], 0);
  const sugars = dish.foods.every((f) => f.nutrients!.sugar !== undefined && f.nutrients!.addedSugar !== undefined);
  return {
    kcal: Math.round(sum("kcal")),
    protein: r1(sum("protein")),
    carbs: r1(sum("carbs")),
    fat: r1(sum("fat")),
    fiber: r1(sum("fiber")),
    ...(sugars ? { sugar: r1(dish.foods.reduce((s, f) => s + f.nutrients!.sugar!, 0)), addedSugar: r1(dish.foods.reduce((s, f) => s + f.nutrients!.addedSugar!, 0)) } : {}),
  };
}

/** The same dish twice in a group (by any of its names) is kept once, with all its names. */
function mergeDishes(dishes: Dish[]): Dish[] {
  const out: Dish[] = [];
  for (const dish of dishes) {
    const keys = dishKeys(dish);
    const same = out.find((d) => dishKeys(d).some((k) => keys.includes(k)));
    if (!same) {
      out.push({ ...dish, aliases: [...dish.aliases] });
      continue;
    }
    for (const name of [dish.name, ...dish.aliases]) {
      if (!dishKeys(same).includes(dishKey(name))) same.aliases.push(name);
    }
  }
  return out;
}

/**
 * The groups after linking `alternative` to `dish`: added to the group of either, or a new group; when they were in
 * two different groups, those become one. Pure: the store saves the result.
 */
export function linkDish(groups: DishGroup[], link: DishLink): { keep: DishGroup | null; drop: number[]; dishes: Dish[] } {
  const a = findDish(groups, link.dish.name);
  const b = findDish(groups, link.alternative.name);
  if (a && b && a.group.id === b.group.id) return { keep: a.group, drop: [], dishes: a.group.dishes };
  const keep = a?.group ?? b?.group ?? null;
  const other = a && b ? b.group : null;
  const dishes = mergeDishes([...(keep?.dishes ?? []), ...(other?.dishes ?? []), link.dish, link.alternative]);
  return { keep, drop: other ? [other.id] : [], dishes: dishes.slice(0, DISH_GROUP_MAX_DISHES) };
}

/** Foods of a favorite (its logged items) as planned foods with their values. */
export function plannedFoodsOf(items: Array<{ name: string; quantity: number | null; unit: string | null; nutrients: { kcal: number; protein: number; carbs: number; fat: number; fiber: number | null; sugar: number | null; addedSugar: number | null } }>): PlannedFood[] {
  return items.map((item) => {
    const n = item.nutrients;
    const sugars = n.sugar !== null && n.addedSugar !== null;
    return {
      name: item.name,
      ...(item.quantity !== null && item.quantity > 0 ? { quantity: item.quantity, ...(item.unit ? { unit: item.unit } : {}) } : {}),
      nutrients: { kcal: n.kcal, protein: n.protein, carbs: n.carbs, fat: n.fat, fiber: n.fiber ?? 0, ...(sugars ? { sugar: n.sugar!, addedSugar: Math.min(n.addedSugar!, n.sugar!) } : {}) },
    };
  });
}
