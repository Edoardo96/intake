import { z } from "zod";
import type { SavedMeal } from "./api.js";
import { dishKey } from "./dishGroups.js";
import { NUTRITION_MEAL_TYPES } from "./nutrition.js";

/**
 * Piatti (Piano › Piatti, docs/dishes.md): the person's dishes are Nutrition's saved meals, so they can also be logged by
 * talking to Claude. Intake adds what Nutrition has no place for: a category and a recipe, stored locally by the saved
 * meal's id.
 */

/** Built-in categories, in the order they are shown; their names are in the app's language. Own ones are plain names. */
export const DISH_CATEGORIES = ["breakfast", "first", "main", "single", "side", "snack", "dessert"] as const;
export type BuiltInDishCategory = (typeof DISH_CATEGORIES)[number];
export const DISH_CUSTOM_CATEGORIES_MAX = 12;

export const dishCategorySchema = z.string().trim().min(1).max(40);

/** A dish of the list: the saved meal with its category and whether it has a recipe. */
export interface DishSummary extends SavedMeal {
  category: string | null;
  hasRecipe: boolean;
  /** Other names of the dish: plan dishes merged into it ("Unisci", docs/plan-dishes.md). */
  aliases: string[];
}

/** POST /api/dishes/:id/aliases and /aliases/remove: one other name of the dish. */
export const dishAliasSchema = z.strictObject({ name: z.string().trim().min(1).max(100) });

/** GET /api/dishes */
export interface DishesResponse {
  dishes: DishSummary[];
  /** Categories added by the person, after the built-in ones. */
  customCategories: string[];
}

const nutrientsSchema = z.strictObject({
  kcal: z.number().min(0).max(5000),
  protein: z.number().min(0).max(500),
  carbs: z.number().min(0).max(1000),
  fat: z.number().min(0).max(500),
  fiber: z.number().min(0).max(200),
  sugar: z.number().min(0).max(500).optional(),
  addedSugar: z.number().min(0).max(500).optional(),
});

export const dishFoodSchema = z.strictObject({
  name: z.string().trim().min(1).max(80),
  quantity: z.number().positive().max(100000).optional(),
  unit: z.string().trim().max(12).optional(),
  /** The food's own values for its amount; when every food has them, the dish is saved food by food. */
  nutrients: nutrientsSchema.optional(),
});
export type DishFood = z.infer<typeof dishFoodSchema>;

/** POST /api/dishes and PATCH /api/dishes/:id */
export const dishWriteSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(100),
    category: dishCategorySchema.nullable(),
    mealType: z.enum(NUTRITION_MEAL_TYPES).nullable().default(null),
    foods: z.array(dishFoodSchema).min(1).max(30),
    /** The dish's totals, needed when any food has no values of its own. */
    totals: nutrientsSchema.optional(),
  })
  .refine((dish) => dish.totals !== undefined || dish.foods.every((food) => food.nutrients), { message: "values_needed" });
export type DishWrite = z.infer<typeof dishWriteSchema>;

export const recipeSchema = z.strictObject({
  minutes: z.number().int().min(1).max(600),
  servings: z.number().int().min(1).max(12),
  difficulty: z.enum(["easy", "medium", "hard"]),
  ingredients: z.array(z.string().trim().min(1).max(160)).min(1).max(30),
  steps: z.array(z.string().trim().min(1).max(600)).min(1).max(15),
  tip: z.string().trim().max(400).optional(),
});
export type Recipe = z.infer<typeof recipeSchema>;

/** Claude models for "Chiedi la ricetta all'IA" (Impostazioni › Funzioni › Modello per le ricette); Haiku by default. */
export const RECIPE_MODELS = ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"] as const;
export const DEFAULT_RECIPE_MODEL = "claude-haiku-5-5";

/** GET / PUT /api/dishes/recipe/model */
export interface RecipeModelResponse {
  model: string;
  models: string[];
}

/** A recipe as kept with the dish. */
export interface StoredRecipe {
  recipe: Recipe;
  /** When it was written or last edited. */
  at: string;
  /** "ai" until the person edits it. */
  source: "ai" | "manual";
  /** The dish's foods when the recipe was written, to tell when they have changed since. */
  foodsKey: string;
}

/** GET /api/dishes/:id/recipe */
export interface RecipeResponse {
  recipe: StoredRecipe | null;
  /** The dish's foods changed after the recipe was written. */
  stale: boolean;
}

/** The foods of a dish, compared without case, accents or punctuation, to tell when they change. */
export function dishFoodsKey(foods: Array<{ name: string; quantity: number | null; unit: string | null }>): string {
  return foods.map((food) => dishKey(`${food.name} ${food.quantity ?? ""} ${food.unit ?? ""}`)).join("|");
}

/** Built-in categories, then the person's own ones. */
export function dishCategories(custom: string[]): string[] {
  return [...DISH_CATEGORIES, ...custom.filter((name) => !(DISH_CATEGORIES as readonly string[]).includes(name))];
}

/** Dishes whose name or foods contain the search, compared without case, accents or punctuation. */
export function searchDishes<T extends Pick<SavedMeal, "name" | "items">>(dishes: T[], query: string): T[] {
  const key = dishKey(query);
  if (!key) return dishes;
  return dishes.filter((dish) => dishKey(`${dish.name} ${dish.items.map((item) => item.name).join(" ")}`).includes(key));
}
