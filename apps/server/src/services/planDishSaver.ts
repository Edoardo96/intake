import { looseDishKey, planDishes, similarDishes, type MealPlan } from "@intake/shared";
import type { DishStore } from "../db/dishStore.js";
import { rateLimitFrom } from "../mcp/connection.js";
import type { NutritionApi } from "../mcp/nutritionApi.js";
import { savedMealFields } from "../routes/dishes.js";

/** Pause between two saved meals: at most 30 writes a minute, half of Nutrition's 60 requests, so the app stays usable. */
const GAP_MS = 2000;

/**
 * "Salva tutti i piatti del piano" (Piano ⋯): the plan's dishes that are not yet in Piano › Piatti become Nutrition
 * saved meals, one every 2 seconds in the background (a week can hold 20–30 dishes). Only when the person asks; a dish
 * already there by its name without amounts is left alone. Rules in docs/plan-dishes.md.
 */
export class PlanDishSaver {
  private running: Promise<void> | null = null;
  /** Dishes still to save in the current run, for the app's progress line. */
  pending = 0;

  constructor(
    private readonly api: Pick<NutritionApi, "savedMeals" | "createSavedMeal">,
    private readonly store: Pick<DishStore, "setCategory" | "all">,
    private readonly log: { info: (details: object, message: string) => void; warn: (details: object, message: string) => void },
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}

  /**
   * The dishes of the plan not yet in Piatti (by name or by a name merged into a dish), split into those that can be
   * saved at once and those that look like a dish already there: those wait for "Unisci o nuovo?" in the meal menu.
   * One get_saved_meals, cached 30 s.
   */
  async missing(plan: MealPlan) {
    const meta = this.store.all();
    const saved = (await this.api.savedMeals()).map((meal) => ({ ...meal, aliases: meta.get(meal.id)?.aliases ?? [] }));
    const there = new Set(saved.flatMap((meal) => [meal.name, ...meal.aliases].map(looseDishKey)));
    const todo = planDishes(plan).filter((dish) => !there.has(dish.key));
    const similar = todo.filter((dish) => similarDishes(dish, saved, 1).length > 0);
    return { todo: todo.filter((dish) => !similar.includes(dish)), similar };
  }

  /** Starts saving the missing dishes that look like no other; answers how many will be saved and how many wait. */
  async saveAll(plan: MealPlan): Promise<{ saving: number; similar: number }> {
    if (this.running) return { saving: this.pending, similar: 0 };
    const { todo, similar } = await this.missing(plan);
    if (todo.length === 0) return { saving: 0, similar: similar.length };
    this.pending = todo.length;
    this.running = this.run(todo).finally(() => {
      this.running = null;
      this.pending = 0;
    });
    return { saving: todo.length, similar: similar.length };
  }

  /** Waits for the current run (tests). */
  idle(): Promise<void> {
    return this.running ?? Promise.resolve();
  }

  private async run(todo: Awaited<ReturnType<PlanDishSaver["missing"]>>["todo"]): Promise<void> {
    let created = 0;
    for (const dish of todo) {
      const { key: _key, ...write } = dish;
      // A rate limit waits and tries the same dish once more; any other failure skips the dish
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const { id } = await this.api.createSavedMeal({ name: write.name, ...savedMealFields(write) });
          if (id) this.store.setCategory(id, write.category);
          created++;
          break;
        } catch (error) {
          const limited = rateLimitFrom(error);
          if (!limited) {
            this.log.warn({ error: error instanceof Error ? error.message : String(error) }, "plan dishes: one not saved");
            break;
          }
          await this.sleep(limited.retryAfterSeconds * 1000);
        }
      }
      this.pending--;
      await this.sleep(GAP_MS);
    }
    this.log.info({ created }, "plan dishes saved to Piatti");
  }
}
