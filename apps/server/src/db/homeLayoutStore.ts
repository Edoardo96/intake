import type { DatabaseSync } from "node:sqlite";
import { completeHomeLayout, type HomeLayout } from "@intake/shared";

const SETTINGS_KEY = "home_layout";

/** Order and visibility of the cards of Oggi, for the whole installation (settings table). */
export class HomeLayoutStore {
  constructor(private readonly db: DatabaseSync) {}

  get(): HomeLayout {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(SETTINGS_KEY) as { value: string } | undefined;
    if (!row) return completeHomeLayout(null);
    try {
      return completeHomeLayout(JSON.parse(row.value) as Partial<HomeLayout>);
    } catch {
      return completeHomeLayout(null);
    }
  }

  set(layout: Partial<HomeLayout>): HomeLayout {
    const complete = completeHomeLayout(layout);
    this.db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(SETTINGS_KEY, JSON.stringify(complete));
    return complete;
  }
}
