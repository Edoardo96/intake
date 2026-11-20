import type { DatabaseSync } from "node:sqlite";
import { DEFAULT_RECOGNITION_MODEL, RECOGNITION_MODELS } from "@intake/shared";

const SETTINGS_KEY = "recognition_model";

/**
 * Claude model for the meal recognition, chosen in Impostazioni (settings key `recognition_model`). Without a choice it
 * is RECOGNITION_MODEL from .env, else Haiku. Only the offered models can be stored.
 */
export class RecognitionModelStore {
  private cached: string | null = null;
  readonly models: string[];
  private readonly fallback: string;

  constructor(
    private readonly db: DatabaseSync,
    envModel?: string,
  ) {
    this.fallback = envModel ?? DEFAULT_RECOGNITION_MODEL;
    this.models = [...new Set<string>([...RECOGNITION_MODELS, this.fallback])];
  }

  get(): string {
    if (this.cached) return this.cached;
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(SETTINGS_KEY) as { value: string } | undefined;
    this.cached = row && this.models.includes(row.value) ? row.value : this.fallback;
    return this.cached;
  }

  /** False when the model is not one of the offered ones. */
  set(model: string): boolean {
    if (!this.models.includes(model)) return false;
    this.db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(SETTINGS_KEY, model);
    this.cached = model;
    return true;
  }
}
