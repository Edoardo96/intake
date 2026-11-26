import type { DatabaseSync } from "node:sqlite";
import { WEEKDAYS, mealPlanSchema, normalizeCourses, type MealIndexMaps, type MealPlan, type PlanStatus, type PlanVersion, type StoredPlan } from "@intake/shared";

interface PlanRow {
  id: number;
  valid_from: string;
  uploaded_at: string;
  content: string;
}

export interface PlanSkip {
  planId: number;
  index: number;
}

export interface PlanLink {
  planId: number;
  index: number;
  mealId: string;
}

function toStored(row: PlanRow): StoredPlan {
  return {
    id: row.id,
    validFrom: row.valid_from,
    uploadedAt: row.uploaded_at,
    plan: mealPlanSchema.parse(JSON.parse(row.content)),
  };
}

/**
 * Meal plan versions. A plan is in effect from its validFrom date until the next plan's validFrom;
 * when two versions share a validFrom, the latest upload wins. Old versions are kept as history.
 */
export class PlanStore {
  constructor(
    private readonly db: DatabaseSync,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Replaces the content of a version (e.g. a meal time changed in Piano); false when there is no such version. */
  update(id: number, plan: MealPlan): boolean {
    const result = this.db.prepare("UPDATE plans SET content = ?, valid_from = ? WHERE id = ?").run(JSON.stringify(plan), plan.validFrom, id);
    return Number(result.changes) > 0;
  }

  add(input: MealPlan): StoredPlan {
    // A meal with courses keeps its foods and macros equal to those of its courses (docs/courses.md)
    const plan = normalizeCourses(input);
    const uploadedAt = this.now().toISOString();
    const result = this.db
      .prepare("INSERT INTO plans (valid_from, uploaded_at, content) VALUES (?, ?, ?)")
      .run(plan.validFrom, uploadedAt, JSON.stringify(plan));
    return { id: Number(result.lastInsertRowid), validFrom: plan.validFrom, uploadedAt, plan };
  }

  get(id: number): StoredPlan | null {
    const row = this.db.prepare("SELECT * FROM plans WHERE id = ?").get(id) as PlanRow | undefined;
    return row ? toStored(row) : null;
  }

  /** The plan in effect on `date` (YYYY-MM-DD). */
  activeOn(date: string): StoredPlan | null {
    const row = this.db
      .prepare("SELECT * FROM plans WHERE valid_from <= ? ORDER BY valid_from DESC, uploaded_at DESC, id DESC LIMIT 1")
      .get(date) as PlanRow | undefined;
    return row ? toStored(row) : null;
  }

  /** All versions, newest validFrom first, with their status relative to `today`. */
  versions(today: string): PlanVersion[] {
    const rows = this.db
      .prepare("SELECT id, valid_from, uploaded_at FROM plans ORDER BY valid_from DESC, uploaded_at DESC, id DESC")
      .all() as Omit<PlanRow, "content">[];
    const activeId = this.activeOn(today)?.id;
    return rows.map((row) => {
      const status: PlanStatus = row.id === activeId ? "active" : row.valid_from > today ? "scheduled" : "superseded";
      return { id: row.id, validFrom: row.valid_from, uploadedAt: row.uploaded_at, status };
    });
  }

  addLink(date: string, planId: number, index: number, mealId: string): void {
    this.db
      .prepare(
        `INSERT INTO plan_links (date, plan_id, meal_index, meal_id) VALUES (?, ?, ?, ?)
         ON CONFLICT (date, plan_id, meal_index) DO UPDATE SET meal_id = excluded.meal_id`,
      )
      .run(date, planId, index, mealId);
  }

  linksOn(date: string): PlanLink[] {
    const rows = this.db.prepare("SELECT plan_id, meal_index, meal_id FROM plan_links WHERE date = ?").all(date) as Array<{
      plan_id: number;
      meal_index: number;
      meal_id: string;
    }>;
    return rows.map((row) => ({ planId: row.plan_id, index: row.meal_index, mealId: row.meal_id }));
  }

  /** Marks a planned meal as skipped on `date` (idempotent). */
  addSkip(date: string, planId: number, index: number): void {
    this.db.prepare("INSERT OR IGNORE INTO plan_skips (date, plan_id, meal_index) VALUES (?, ?, ?)").run(date, planId, index);
  }

  removeSkip(date: string, planId: number, index: number): void {
    this.db.prepare("DELETE FROM plan_skips WHERE date = ? AND plan_id = ? AND meal_index = ?").run(date, planId, index);
  }

  skipsOn(date: string): PlanSkip[] {
    const rows = this.db.prepare("SELECT plan_id, meal_index FROM plan_skips WHERE date = ?").all(date) as Array<{ plan_id: number; meal_index: number }>;
    return rows.map((row) => ({ planId: row.plan_id, index: row.meal_index }));
  }

  /** Planned meals logged with "Mangiato come previsto" between two dates (inclusive). */
  linkCountBetween(start: string, end: string): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM plan_links WHERE date BETWEEN ? AND ?").get(start, end) as { n: number }).n;
  }

  skipCountBetween(start: string, end: string): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM plan_skips WHERE date BETWEEN ? AND ?").get(start, end) as { n: number }).n;
  }

  /**
   * After a change that moves meals (a meal taken out, put back or added): the links and skips of plan `fromId` from
   * `fromDate` on go to plan `toId` at the meals' new positions; those of a meal no longer there are dropped.
   */
  moveRefs(fromId: number, toId: number, fromDate: string, maps: MealIndexMaps): void {
    const weekday = (date: string) => WEEKDAYS[(new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7]!;
    const target = (date: string, index: number): number | null => {
      const map = maps[weekday(date)];
      return map ? (map[index] ?? null) : index;
    };
    for (const table of ["plan_links", "plan_skips"] as const) {
      const columns = table === "plan_links" ? "date, meal_index, meal_id, created_at" : "date, meal_index, created_at";
      const rows = this.db.prepare(`SELECT ${columns} FROM ${table} WHERE plan_id = ? AND date >= ?`).all(fromId, fromDate) as Array<{ date: string; meal_index: number; meal_id?: string; created_at: string }>;
      this.db.prepare(`DELETE FROM ${table} WHERE plan_id = ? AND date >= ?`).run(fromId, fromDate);
      for (const row of rows) {
        const index = target(row.date, row.meal_index);
        if (index === null) continue;
        if (table === "plan_links") this.db.prepare("INSERT OR REPLACE INTO plan_links (date, plan_id, meal_index, meal_id, created_at) VALUES (?, ?, ?, ?, ?)").run(row.date, toId, index, row.meal_id!, row.created_at);
        else this.db.prepare("INSERT OR IGNORE INTO plan_skips (date, plan_id, meal_index, created_at) VALUES (?, ?, ?, ?)").run(row.date, toId, index, row.created_at);
      }
    }
  }
}
