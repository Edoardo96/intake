import type { DatabaseSync } from "node:sqlite";
import { MEAL_COURSES_MAX, type MealCourse } from "@intake/shared";
import { z } from "zod";

export const mealCoursesSchema = z
  .array(z.object({ name: z.string().trim().min(1).max(30), count: z.number().int().min(1).max(30) }))
  .min(2)
  .max(MEAL_COURSES_MAX);

/** Courses of logged meals (table `meal_courses`, by Nutrition meal id): only names and food counts. docs/courses.md. */
export class MealCourseStore {
  constructor(private readonly db: DatabaseSync) {}

  get(mealId: string): MealCourse[] | null {
    const row = this.db.prepare("SELECT courses FROM meal_courses WHERE meal_id = ?").get(mealId.toLowerCase()) as { courses: string } | undefined;
    if (!row) return null;
    try {
      const parsed = mealCoursesSchema.safeParse(JSON.parse(row.courses));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  /** Null (or fewer than two courses) removes them: the meal is one dish. */
  set(mealId: string, courses: MealCourse[] | null): void {
    if (!courses || courses.length < 2) {
      this.db.prepare("DELETE FROM meal_courses WHERE meal_id = ?").run(mealId.toLowerCase());
      return;
    }
    this.db
      .prepare("INSERT INTO meal_courses (meal_id, courses) VALUES (?, ?) ON CONFLICT(meal_id) DO UPDATE SET courses = excluded.courses")
      .run(mealId.toLowerCase(), JSON.stringify(courses));
  }
}
