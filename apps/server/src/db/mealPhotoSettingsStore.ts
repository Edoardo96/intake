import type { DatabaseSync } from "node:sqlite";

const SETTINGS_KEY = "keep_meal_photos";

/**
 * Impostazioni › Pasti da foto › "Conserva le foto dei pasti" (settings key `keep_meal_photos`). On by default; when off,
 * a photo is only sent for the recognition and never stored with the meal. Rules in docs/photo-meals.md.
 */
export class MealPhotoSettingsStore {
  private cached: boolean | null = null;

  constructor(private readonly db: DatabaseSync) {}

  keep(): boolean {
    if (this.cached !== null) return this.cached;
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(SETTINGS_KEY) as { value: string } | undefined;
    this.cached = row?.value !== "off";
    return this.cached;
  }

  setKeep(keep: boolean): void {
    this.db
      .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(SETTINGS_KEY, keep ? "on" : "off");
    this.cached = keep;
  }
}
