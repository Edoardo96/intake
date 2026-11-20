import type { DatabaseSync } from "node:sqlite";
import { LANGUAGES, type Language } from "@intake/shared";

const SETTINGS_KEY = "language";
export const DEFAULT_LANGUAGE: Language = "it";

export const isLanguage = (value: unknown): value is Language => typeof value === "string" && (LANGUAGES as readonly string[]).includes(value);

/** UI language for the whole installation (settings table). Also used for notifications, the daily insight and recognized food names. */
export class LanguageStore {
  private cached: Language | null = null;

  constructor(private readonly db: DatabaseSync) {}

  get(): Language {
    if (this.cached) return this.cached;
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(SETTINGS_KEY) as { value: string } | undefined;
    this.cached = row && isLanguage(row.value) ? row.value : DEFAULT_LANGUAGE;
    return this.cached;
  }

  set(language: Language): Language {
    this.db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(SETTINGS_KEY, language);
    this.cached = language;
    return language;
  }
}
