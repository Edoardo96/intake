import type { DatabaseSync } from "node:sqlite";
import { DEFAULT_RECIPE_MODEL, DISH_CUSTOM_CATEGORIES_MAX, RECIPE_MODELS, recipeSchema, type StoredRecipe } from "@intake/shared";
import { z } from "zod";

const CATEGORIES_KEY = "dish_categories";
const MODEL_KEY = "recipe_model";

const storedRecipeSchema = z.object({
  recipe: recipeSchema,
  at: z.string(),
  source: z.enum(["ai", "manual"]),
  foodsKey: z.string(),
});

interface Row {
  saved_meal_id: string;
  category: string | null;
  recipe: string | null;
  aliases: string | null;
}

export const DISH_ALIASES_MAX = 20;

function parseAliases(text: string | null | undefined): string[] {
  if (!text) return [];
  try {
    const list = z.array(z.string()).safeParse(JSON.parse(text));
    return list.success ? list.data : [];
  } catch {
    return [];
  }
}

/**
 * Piatti: the category and the recipe of each dish (table `dish_meta`, by Nutrition saved meal id, lower case), and the
 * person's own categories (settings key `dish_categories`). The dish itself lives on Nutrition. Rules in docs/dishes.md.
 */
export class DishStore {
  constructor(private readonly db: DatabaseSync) {}

  /** Saved meal id → category, whether a recipe is kept, and the other names the dish goes by in the plan. */
  all(): Map<string, { category: string | null; hasRecipe: boolean; aliases: string[] }> {
    const rows = this.db.prepare("SELECT saved_meal_id, category, recipe, aliases FROM dish_meta").all() as unknown as Row[];
    return new Map(rows.map((row) => [row.saved_meal_id, { category: row.category, hasRecipe: row.recipe !== null, aliases: parseAliases(row.aliases) }]));
  }

  aliases(id: string): string[] {
    return parseAliases(this.row(id)?.aliases);
  }

  /** The dish's other names (a plan dish merged into it); without repeats, at most DISH_ALIASES_MAX. */
  setAliases(id: string, names: string[]): string[] {
    const seen = new Set<string>();
    const unique = names.map((n) => n.trim().slice(0, 100)).filter((n) => n && !seen.has(n.toLowerCase()) && seen.add(n.toLowerCase())).slice(-DISH_ALIASES_MAX);
    this.db
      .prepare(
        "INSERT INTO dish_meta (saved_meal_id, aliases) VALUES (?, ?) ON CONFLICT(saved_meal_id) DO UPDATE SET aliases = excluded.aliases, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
      )
      .run(id.toLowerCase(), unique.length > 0 ? JSON.stringify(unique) : null);
    return unique;
  }

  category(id: string): string | null {
    return this.row(id)?.category ?? null;
  }

  setCategory(id: string, category: string | null): void {
    this.db
      .prepare(
        "INSERT INTO dish_meta (saved_meal_id, category) VALUES (?, ?) ON CONFLICT(saved_meal_id) DO UPDATE SET category = excluded.category, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
      )
      .run(id.toLowerCase(), category);
  }

  recipe(id: string): StoredRecipe | null {
    const text = this.row(id)?.recipe;
    if (!text) return null;
    try {
      const parsed = storedRecipeSchema.safeParse(JSON.parse(text));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  setRecipe(id: string, recipe: StoredRecipe | null): void {
    this.db
      .prepare(
        "INSERT INTO dish_meta (saved_meal_id, recipe) VALUES (?, ?) ON CONFLICT(saved_meal_id) DO UPDATE SET recipe = excluded.recipe, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
      )
      .run(id.toLowerCase(), recipe ? JSON.stringify(recipe) : null);
  }

  /** The dish was deleted on Nutrition. */
  delete(id: string): void {
    this.db.prepare("DELETE FROM dish_meta WHERE saved_meal_id = ?").run(id.toLowerCase());
  }

  customCategories(): string[] {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(CATEGORIES_KEY) as { value: string } | undefined;
    try {
      const list = z.array(z.string()).safeParse(row ? JSON.parse(row.value) : []);
      return list.success ? list.data.slice(0, DISH_CUSTOM_CATEGORIES_MAX) : [];
    } catch {
      return [];
    }
  }

  setCustomCategories(names: string[]): string[] {
    const unique = [...new Set(names.map((name) => name.trim()).filter(Boolean))].slice(0, DISH_CUSTOM_CATEGORIES_MAX);
    this.db
      .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(CATEGORIES_KEY, JSON.stringify(unique));
    return unique;
  }

  /** Claude model of the AI recipes (settings key `recipe_model`); Haiku until changed. */
  recipeModel(): string {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(MODEL_KEY) as { value: string } | undefined;
    return row && (RECIPE_MODELS as readonly string[]).includes(row.value) ? row.value : DEFAULT_RECIPE_MODEL;
  }

  /** False when the model is not one of RECIPE_MODELS. */
  setRecipeModel(model: string): boolean {
    if (!(RECIPE_MODELS as readonly string[]).includes(model)) return false;
    this.db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(MODEL_KEY, model);
    return true;
  }

  private row(id: string): Row | undefined {
    return this.db.prepare("SELECT saved_meal_id, category, recipe, aliases FROM dish_meta WHERE saved_meal_id = ?").get(id.toLowerCase()) as Row | undefined;
  }
}
