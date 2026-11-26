import type { DatabaseSync } from "node:sqlite";
import { dishSchema, linkDish, type Dish, type DishGroup, type DishLink } from "@intake/shared";
import { z } from "zod";

const dishesSchema = z.array(dishSchema);

/**
 * Piatti intercambiabili (table `dish_groups`): one row per group, its dishes as JSON. Kept per installation, apart
 * from the plans, so a group lasts when a new plan is uploaded or generated. Rules in docs/dish-groups.md.
 */
export class DishGroupStore {
  constructor(private readonly db: DatabaseSync) {}

  list(): DishGroup[] {
    const rows = this.db.prepare("SELECT id, dishes FROM dish_groups ORDER BY id").all() as Array<{ id: number; dishes: string }>;
    return rows.flatMap((row) => {
      try {
        const dishes = dishesSchema.parse(JSON.parse(row.dishes));
        return dishes.length > 1 ? [{ id: row.id, dishes }] : [];
      } catch {
        return [];
      }
    });
  }

  get(id: number): DishGroup | null {
    return this.list().find((group) => group.id === id) ?? null;
  }

  /** Links `alternative` to `dish`: added to an existing group, two groups merged, or a new group. */
  link(link: DishLink): DishGroup {
    const result = linkDish(this.list(), link);
    for (const id of result.drop) this.delete(id);
    if (result.keep) {
      this.update(result.keep.id, result.dishes);
      return { id: result.keep.id, dishes: result.dishes };
    }
    const { lastInsertRowid } = this.db.prepare("INSERT INTO dish_groups (dishes) VALUES (?)").run(JSON.stringify(result.dishes));
    return { id: Number(lastInsertRowid), dishes: result.dishes };
  }

  /** A group with fewer than two dishes has nothing to swap: it is removed. */
  update(id: number, dishes: Dish[]): void {
    if (dishes.length < 2) {
      this.delete(id);
      return;
    }
    this.db
      .prepare("UPDATE dish_groups SET dishes = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?")
      .run(JSON.stringify(dishes), id);
  }

  delete(id: number): void {
    this.db.prepare("DELETE FROM dish_groups WHERE id = ?").run(id);
  }
}
