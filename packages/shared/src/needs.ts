/**
 * "Il tuo fabbisogno" (Piano): the daily energy and macro needs computed from a few fields, and the check of the
 * active goal against the logged meals and the weight trend. Plain arithmetic, no AI: the AI opinion is separate
 * and its proposal goes through the same safety limits (`limitTargets`). Rules in docs/needs.md.
 */
import { z } from "zod";

export const NEEDS_SEXES = ["male", "female"] as const;
export const NEEDS_JOBS = ["seated", "standing", "physical"] as const;
export const NEEDS_TRAINING_TYPES = ["weights", "cardio", "mixed"] as const;
export const NEEDS_GOALS = ["cut", "maintain", "recomp", "bulk"] as const;
export const NEEDS_PACES = ["steady", "fast"] as const;

export type NeedsSex = (typeof NEEDS_SEXES)[number];
export type NeedsJob = (typeof NEEDS_JOBS)[number];
export type NeedsTrainingType = (typeof NEEDS_TRAINING_TYPES)[number];
export type NeedsGoal = (typeof NEEDS_GOALS)[number];
export type NeedsPace = (typeof NEEDS_PACES)[number];

/** The fields of "Calcola il tuo fabbisogno"; the weight is not here, it is read from Nutrition. */
export const needsProfileSchema = z
  .object({
    sex: z.enum(NEEDS_SEXES),
    /** The formula is for adults. */
    age: z.number().int().min(18).max(100),
    heightCm: z.number().int().min(120).max(230),
    job: z.enum(NEEDS_JOBS),
    /** Average steps a day; null when unknown (no Apple Health data and nothing typed). */
    stepsPerDay: z.number().int().min(0).max(50_000).nullable(),
    trainingPerWeek: z.number().int().min(0).max(14),
    trainingType: z.enum(NEEDS_TRAINING_TYPES),
    /** Average length of a session, in minutes. */
    trainingMinutes: z.number().int().min(0).max(240),
    goal: z.enum(NEEDS_GOALS),
    /** Only used for cut and bulk. */
    pace: z.enum(NEEDS_PACES),
    /** Free notes for the AI opinion (allergies, preferences, schedule); not used by the calculation. */
    notes: z.string().trim().max(500).default(""),
  })
  .strict();

export type NeedsProfile = z.infer<typeof needsProfileSchema>;

export interface NeedsTargets {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface NeedsResult extends NeedsTargets {
  /** Basal metabolic rate (Mifflin-St Jeor), kcal. */
  bmr: number;
  /** Estimated maintenance: basal × daily life + extra steps + training, kcal. */
  maintenance: number;
  /** Expected weight change a week at these calories, in kg (negative: losing). */
  weeklyChangeKg: number;
  /** True when the safety floor raised the calories. */
  limited: boolean;
}

/** Daily life without training, as a multiple of the basal rate. */
const JOB_FACTOR: Record<NeedsJob, number> = { seated: 1.2, standing: 1.35, physical: 1.55 };
/** Steps already counted by the job factor; only the steps above it add energy. */
const JOB_STEPS: Record<NeedsJob, number> = { seated: 5_000, standing: 9_000, physical: 13_000 };
/** About 0.035 kcal a step at 70 kg. */
const KCAL_PER_STEP_PER_KG = 0.0005;
/** Energy of a training session, kcal per kg per minute (weights include rests between sets). */
const TRAINING_KCAL_PER_KG_MIN: Record<NeedsTrainingType, number> = { weights: 0.07, cardio: 0.11, mixed: 0.09 };
/** A kilogram of body weight is about 7,700 kcal. */
export const KCAL_PER_KG = 7_700;

/** Calories relative to maintenance for each goal and pace. */
export function goalAdjustment(goal: NeedsGoal, pace: NeedsPace): number {
  switch (goal) {
    case "cut":
      return pace === "fast" ? -0.22 : -0.15;
    case "bulk":
      return pace === "fast" ? 0.12 : 0.07;
    case "recomp":
      return -0.05;
    case "maintain":
      return 0;
  }
}

/** Protein in g per kg of body weight for each goal. */
const PROTEIN_G_PER_KG: Record<NeedsGoal, number> = { cut: 2.2, recomp: 2.0, maintain: 1.6, bulk: 1.8 };
/** Share of calories from fat, with a floor in g per kg. */
const FAT_SHARE = 0.27;
const FAT_MIN_G_PER_KG = 0.7;

/** Safety limits: never below these calories, never more than 25% under or 20% over maintenance. */
export const NEEDS_LIMITS = {
  minKcal: { male: 1_500, female: 1_200 } satisfies Record<NeedsSex, number>,
  maxDeficit: 0.25,
  maxSurplus: 0.2,
  proteinGPerKg: { min: 0.8, max: 3 },
  fatMinGPerKg: 0.5,
} as const;

const round = (value: number, step: number) => Math.round(value / step) * step;

export function basalRate(profile: Pick<NeedsProfile, "sex" | "age" | "heightCm">, weightKg: number): number {
  const base = 10 * weightKg + 6.25 * profile.heightCm - 5 * profile.age;
  return base + (profile.sex === "male" ? 5 : -161);
}

/** Maintenance calories from the profile and the weight (not rounded). */
export function maintenanceOf(profile: NeedsProfile, weightKg: number): { bmr: number; maintenance: number } {
  const bmr = basalRate(profile, weightKg);
  const steps = profile.stepsPerDay === null ? 0 : Math.max(0, profile.stepsPerDay - JOB_STEPS[profile.job]) * KCAL_PER_STEP_PER_KG * weightKg;
  const training = (profile.trainingPerWeek * profile.trainingMinutes * TRAINING_KCAL_PER_KG_MIN[profile.trainingType] * weightKg) / 7;
  return { bmr, maintenance: bmr * JOB_FACTOR[profile.job] + steps + training };
}

/** The lowest daily calories offered: the basal rate, and never under 1,500 (men) or 1,200 (women). */
export function kcalFloor(profile: Pick<NeedsProfile, "sex" | "age" | "heightCm">, weightKg: number): number {
  return round(Math.max(basalRate(profile, weightKg), NEEDS_LIMITS.minKcal[profile.sex]), 10);
}

/** Protein from the goal, fat from its share, carbs from what is left (grams rounded to 5). */
export function macrosFor(kcal: number, goal: NeedsGoal, weightKg: number): NeedsTargets {
  const protein = round(PROTEIN_G_PER_KG[goal] * weightKg, 5);
  const fat = round(Math.max((FAT_SHARE * kcal) / 9, FAT_MIN_G_PER_KG * weightKg), 5);
  const carbs = Math.max(0, round((kcal - protein * 4 - fat * 9) / 4, 5));
  return { kcal, protein, carbs, fat };
}

/** The standard calculation: maintenance, the goal adjustment, the safety floor and the macros. */
export function computeNeeds(profile: NeedsProfile, weightKg: number): NeedsResult {
  const { bmr, maintenance } = maintenanceOf(profile, weightKg);
  const wanted = round(maintenance * (1 + goalAdjustment(profile.goal, profile.pace)), 10);
  const floor = kcalFloor(profile, weightKg);
  const kcal = Math.max(wanted, floor);
  return {
    ...macrosFor(kcal, profile.goal, weightKg),
    bmr: Math.round(bmr),
    maintenance: round(maintenance, 10),
    weeklyChangeKg: Math.round(((kcal - maintenance) * 7 * 100) / KCAL_PER_KG) / 100,
    limited: kcal > wanted,
  };
}

/**
 * Keeps a proposal (the AI's, or one typed by hand) inside the safety limits: calories between the floor and
 * maintenance −25% / +20%, protein 0.8–3 g/kg, fat at least 0.5 g/kg. `limited` says whether anything changed.
 */
export function limitTargets(targets: NeedsTargets, profile: NeedsProfile, weightKg: number): { targets: NeedsTargets; limited: boolean } {
  const { maintenance } = maintenanceOf(profile, weightKg);
  const minKcal = Math.max(kcalFloor(profile, weightKg), round(maintenance * (1 - NEEDS_LIMITS.maxDeficit), 10));
  const maxKcal = Math.max(minKcal, round(maintenance * (1 + NEEDS_LIMITS.maxSurplus), 10));
  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
  const kcal = clamp(round(targets.kcal, 10), minKcal, maxKcal);
  const protein = clamp(round(targets.protein, 5), round(NEEDS_LIMITS.proteinGPerKg.min * weightKg, 5), round(NEEDS_LIMITS.proteinGPerKg.max * weightKg, 5));
  const fat = Math.max(round(targets.fat, 5), round(NEEDS_LIMITS.fatMinGPerKg * weightKg, 5));
  // Carbs fill what is left, so the grams always add up to the calories
  const carbs = Math.max(0, round((kcal - protein * 4 - fat * 9) / 4, 5));
  const limited = kcal !== round(targets.kcal, 10) || protein !== round(targets.protein, 5) || fat !== round(targets.fat, 5);
  return { targets: { kcal, protein, carbs, fat }, limited };
}

/** Days and weigh-ins the data check needs before it says anything. */
export const NEEDS_CHECK = { windowDays: 21, minLoggedDays: 10, minWeighIns: 3, minWeighInSpanDays: 10, minDayKcal: 800, inLineKcal: 100 } as const;

export type NeedsCheck =
  | { status: "few_data"; loggedDays: number; weighIns: number }
  | {
      status: "ok";
      /** First and last day of the window (the day before today is the last). */
      from: string;
      to: string;
      loggedDays: number;
      /** Average calories of the logged days. */
      avgKcal: number;
      /** Weight trend, kg a week (negative: losing). */
      weeklyChangeKg: number;
      /** Real maintenance: what was eaten, corrected by the weight change. */
      maintenance: number;
      /** Calories that match the goal on the real maintenance. */
      suggestedKcal: number;
      /** The active calorie goal is within 100 kcal of the suggestion. */
      inLine: boolean;
    };

const DAY_MS = 86_400_000;
const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / DAY_MS;
export const addDaysTo = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

/** Least-squares slope of the weigh-ins, in kg a day. */
function slopePerDay(points: Array<{ x: number; y: number }>): number {
  const n = points.length;
  const meanX = points.reduce((s, p) => s + p.x, 0) / n;
  const meanY = points.reduce((s, p) => s + p.y, 0) / n;
  const num = points.reduce((s, p) => s + (p.x - meanX) * (p.y - meanY), 0);
  const den = points.reduce((s, p) => s + (p.x - meanX) ** 2, 0);
  return den === 0 ? 0 : num / den;
}

/**
 * "Verifica sui tuoi dati": the last three weeks of logged calories and the weight trend give the real maintenance
 * (7,700 kcal per kg). Today is left out (not finished), and so are days under 800 kcal (most likely not fully logged).
 */
export function checkNeeds(input: {
  today: string;
  days: Array<{ date: string; kcal: number; mealCount: number }>;
  /** Weigh-ins in kg. */
  weights: Array<{ date: string; weightKg: number }>;
  goal: NeedsGoal;
  pace: NeedsPace;
  /** The active calorie goal in Nutrition, if any. */
  goalKcal: number | null;
  /** The lowest calories to suggest (kcalFloor with a profile, else 1,200). */
  floorKcal: number;
}): NeedsCheck {
  const to = addDaysTo(input.today, -1);
  const from = addDaysTo(input.today, -NEEDS_CHECK.windowDays);
  const logged = input.days.filter((d) => d.date >= from && d.date <= to && d.mealCount > 0 && d.kcal >= NEEDS_CHECK.minDayKcal);
  const weighIns = input.weights.filter((w) => w.date >= from && w.date <= input.today);
  const span = weighIns.length ? dayNumber(weighIns.at(-1)!.date) - dayNumber(weighIns[0]!.date) : 0;
  if (logged.length < NEEDS_CHECK.minLoggedDays || weighIns.length < NEEDS_CHECK.minWeighIns || span < NEEDS_CHECK.minWeighInSpanDays) {
    return { status: "few_data", loggedDays: logged.length, weighIns: weighIns.length };
  }
  const avgKcal = logged.reduce((s, d) => s + d.kcal, 0) / logged.length;
  const perDay = slopePerDay(weighIns.map((w) => ({ x: dayNumber(w.date), y: w.weightKg })));
  const maintenance = round(avgKcal - perDay * KCAL_PER_KG, 10);
  const suggestedKcal = Math.max(input.floorKcal, round(maintenance * (1 + goalAdjustment(input.goal, input.pace)), 10));
  return {
    status: "ok",
    from,
    to,
    loggedDays: logged.length,
    avgKcal: Math.round(avgKcal),
    weeklyChangeKg: Math.round(perDay * 7 * 100) / 100,
    maintenance,
    suggestedKcal,
    inLine: input.goalKcal !== null && Math.abs(input.goalKcal - suggestedKcal) <= NEEDS_CHECK.inLineKcal,
  };
}

/** Where the active goal came from, when it was applied from "Il tuo fabbisogno". */
export const NEEDS_SOURCES = ["standard", "ai", "check"] as const;
export type NeedsSource = (typeof NEEDS_SOURCES)[number];

/** The last AI opinion ("Il parere dell'IA"), kept until the next one. */
export interface NeedsAiOpinion {
  /** ISO time of the request. */
  at: string;
  model: string;
  /** A few sentences: what the AI thinks of the calculation and why it proposes its numbers. */
  summary: string;
  /** Its proposal, already inside the safety limits. */
  targets: NeedsTargets;
  /** True when the safety limits changed the AI's numbers. */
  limited: boolean;
  tips: string[];
}

/** GET /api/needs (and the answer of PUT /api/needs/profile). */
export interface NeedsView {
  today: string;
  /** Latest weigh-in in the last 30 days, in kg; null when there is none. */
  weightKg: number | null;
  profile: NeedsProfile | null;
  /** The standard calculation of the saved profile; null without a profile or a weight. */
  result: NeedsResult | null;
  /** Active goals in Nutrition. */
  goals: { kcal: number | null; protein: number | null; carbs: number | null; fat: number | null };
  /** Where the active goal came from, when applied from here and not changed elsewhere since. */
  applied: { source: NeedsSource; at: string } | null;
  check: NeedsCheck;
  ai: NeedsAiOpinion | null;
  /** The AI opinion can be asked: Pasti da foto on and ANTHROPIC_API_KEY set. */
  aiAvailable: boolean;
  /** Values to fill the form with when there is no profile yet (Apple Health steps, the gym app's workouts). */
  prefill: { stepsPerDay: number | null; trainingPerWeek: number | null; trainingMinutes: number | null };
}

/** POST /api/needs/apply: sets the goals in Nutrition (set_nutrition_goals). */
export interface NeedsApplyRequest {
  source: NeedsSource;
  targets: NeedsTargets;
}
