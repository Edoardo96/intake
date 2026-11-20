import type { DatabaseSync } from "node:sqlite";
import { needsProfileSchema, type NeedsAiOpinion, type NeedsProfile, type NeedsSource, type NeedsTargets } from "@intake/shared";

const SETTINGS_KEY = "needs";

interface Stored {
  profile: NeedsProfile | null;
  /** The goals applied from "Il tuo fabbisogno": the source is shown only while Nutrition still has these numbers. */
  applied: { source: NeedsSource; at: string; targets: NeedsTargets } | null;
  ai: NeedsAiOpinion | null;
}

const EMPTY: Stored = { profile: null, applied: null, ai: null };

/**
 * "Il tuo fabbisogno" (settings key `needs`): the fields of the form (sex, age, height, daily life, training, goal,
 * notes), the source of the last applied goal and the last AI opinion. Nutrition has no place for them; the weight
 * and the goals themselves stay in Nutrition. Rules in docs/needs.md.
 */
export class NeedsStore {
  constructor(private readonly db: DatabaseSync) {}

  get(): Stored {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(SETTINGS_KEY) as { value: string } | undefined;
    if (!row) return { ...EMPTY };
    try {
      const value = JSON.parse(row.value) as Partial<Stored>;
      const profile = needsProfileSchema.safeParse(value.profile);
      return { profile: profile.success ? profile.data : null, applied: value.applied ?? null, ai: value.ai ?? null };
    } catch {
      return { ...EMPTY };
    }
  }

  setProfile(profile: NeedsProfile): void {
    this.save({ ...this.get(), profile });
  }

  setApplied(source: NeedsSource, targets: NeedsTargets, at: string): void {
    this.save({ ...this.get(), applied: { source, at, targets } });
  }

  setAi(ai: NeedsAiOpinion): void {
    this.save({ ...this.get(), ai });
  }

  private save(value: Stored): void {
    this.db
      .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(SETTINGS_KEY, JSON.stringify(value));
  }
}
