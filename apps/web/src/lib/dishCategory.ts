import { DISH_CATEGORIES, alternativesFor, dishKey, plannedFoodsOf, type Dish, type DishGroup, type DishSummary, type SavedMeal } from "@intake/shared";
import { t } from "./strings";

/** A category's name: the built-in ones in the app's language, the person's own as they wrote them. */
export function categoryLabel(category: string): string {
  return (DISH_CATEGORIES as readonly string[]).includes(category) ? t.dishBook.categories[category]! : category;
}

/** How many interchangeable dishes a dish has (Piatti intercambiabili), matched by name. */
export function alternativesCount(groups: DishGroup[] | undefined, dish: Pick<DishSummary, "name" | "description">): number {
  if (!groups) return 0;
  return Math.max(alternativesFor(groups, dish.name).length, alternativesFor(groups, dish.description).length);
}

/** Foods of a dish as one line: "Pasta 100 g · Tonno 80 g". */
export function foodsLine(meal: Pick<SavedMeal, "items" | "description">): string {
  if (meal.items.length === 0) return t.dishBook.totalsOnly;
  return meal.items.map((item) => [item.name, item.quantityText].filter(Boolean).join(" ")).join(" · ");
}

/** A dish of the list as a dish of the plan and of a group of interchangeable dishes. */
export function dishFromSaved(meal: SavedMeal): Dish {
  const foods = plannedFoodsOf(meal.items);
  const aliases = meal.description && dishKey(meal.description) !== dishKey(meal.name) ? [meal.description.slice(0, 200)] : [];
  const totals = meal.kcal !== null ? { kcal: meal.kcal, protein: meal.protein ?? 0, carbs: meal.carbs ?? 0, fat: meal.fat ?? 0, fiber: 0 } : null;
  return {
    name: meal.name,
    aliases,
    foods: foods.length > 0 ? foods : [{ name: meal.description || meal.name }],
    macros: foods.length > 0 ? null : totals,
  };
}
