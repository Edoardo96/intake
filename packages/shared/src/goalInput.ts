/** Reading the daily goals typed in Impostazioni › Obiettivi › Modifica. */

export type GoalKey = "kcal" | "protein" | "carbs" | "fat" | "fiber" | "waterL" | "targetWeight";
export type WeightUnit = "kg" | "lb";

/** Calories and grams are whole numbers; water (litres) and the target weight take decimals. */
const INTEGER_GOALS: ReadonlySet<GoalKey> = new Set(["kcal", "protein", "carbs", "fat", "fiber"]);

/**
 * Sanity ranges checked before saving, tighter than what Nutrition accepts, so that a typo
 * ("22000", "2.2") is refused with a message instead of being saved. Water is in litres.
 */
export const GOAL_INPUT_LIMITS: Record<Exclude<GoalKey, "targetWeight">, { min: number; max: number }> = {
  kcal: { min: 500, max: 10_000 },
  protein: { min: 0, max: 1_000 },
  carbs: { min: 0, max: 1_000 },
  fat: { min: 0, max: 1_000 },
  fiber: { min: 0, max: 200 },
  waterL: { min: 0.5, max: 10 },
};

/** Target weight range, in the unit of the Nutrition profile. */
export const TARGET_WEIGHT_LIMITS: Record<WeightUnit, { min: number; max: number }> = {
  kg: { min: 20, max: 400 },
  lb: { min: 44, max: 880 },
};

/** "lb" or "lbs" (any case) is pounds; anything else is kilograms. */
export function weightUnitOf(unit: string | null | undefined): WeightUnit {
  return unit && /^lbs?$/i.test(unit.trim()) ? "lb" : "kg";
}

/**
 * Reads one goal field.
 * - empty -> null (clears the goal);
 * - calories and grams: whole numbers, where "." or "," followed by exactly three digits is a
 *   thousands separator ("2.200" and "2,200" -> 2200); any other decimal is refused;
 * - water and target weight: "2,5" or "2.5" -> 2.5;
 * - anything else, or a value outside the ranges above -> undefined (invalid, nothing is saved).
 */
export function parseGoalInput(key: GoalKey, text: string, weightUnit: WeightUnit = "kg"): number | null | undefined {
  const trimmed = text.trim().replace(/\s+/g, "");
  if (trimmed === "") return null;
  let value: number;
  if (INTEGER_GOALS.has(key)) {
    if (/^\d{1,3}([.,]\d{3})+$/.test(trimmed)) value = Number(trimmed.replace(/[.,]/g, ""));
    else if (/^\d+$/.test(trimmed)) value = Number(trimmed);
    else return undefined;
  } else {
    if (!/^\d+([.,]\d+)?$/.test(trimmed)) return undefined;
    value = Number(trimmed.replace(",", "."));
  }
  const limits = key === "targetWeight" ? TARGET_WEIGHT_LIMITS[weightUnit] : GOAL_INPUT_LIMITS[key];
  return value >= limits.min && value <= limits.max ? value : undefined;
}
