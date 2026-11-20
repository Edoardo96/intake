import {
  NEEDS_LIMITS,
  NEEDS_CHECK,
  NEEDS_SOURCES,
  addDaysTo,
  checkNeeds,
  computeNeeds,
  kcalFloor,
  needsProfileSchema,
  weightUnitOf,
  type NeedsView,
} from "@intake/shared";
import type { FastifyPluginAsync, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import type { NeedsStore } from "../db/needsStore.js";
import type { NutritionApi } from "../mcp/nutritionApi.js";
import type { HealthDailyValue } from "../parsers/healthAutoExport.js";
import type { GymSource } from "../services/gymSource.js";
import { isGymUnavailable } from "../services/gymSource.js";
import { RecognitionError } from "../services/mealRecognition.js";
import type { NeedsAdvisor } from "../services/needsAdvisor.js";
import { RECOGNITION_STATUS } from "./meals.js";

export interface NeedsRoutesOptions {
  api: Pick<NutritionApi, "clock" | "goals" | "weightTrends" | "summary" | "setGoals">;
  store: NeedsStore;
  /** Apple Health steps for the form (empty while Salute is off). */
  health?: { daily(from: string, to: string, metrics?: Array<HealthDailyValue["metric"]>): HealthDailyValue[] };
  /** The active gym app while Allenamenti is on, for the form. */
  gym?: () => GymSource | null;
  /** The AI opinion; present with ANTHROPIC_API_KEY. */
  advisor?: Pick<NeedsAdvisor, "advise">;
  /** Whether the AI opinion can be used now (Pasti da foto on). */
  aiEnabled?: () => boolean;
  requireOwner: preHandlerHookHandler;
}

const LB_TO_KG = 0.45359237;
/** Weigh-ins read: enough for the three weeks of the check and the latest weight. */
const WEIGHT_DAYS = 30;
/** Days of steps and workouts averaged for the form. */
const PREFILL_STEP_DAYS = 14;
const PREFILL_WORKOUT_DAYS = 28;

const targetsSchema = z.object({
  kcal: z.number().int().min(500).max(10_000),
  protein: z.number().min(0).max(1_000),
  carbs: z.number().min(0).max(1_500),
  fat: z.number().min(0).max(500),
});
const applySchema = z.object({ source: z.enum(NEEDS_SOURCES), targets: targetsSchema }).strict();

const round5 = (value: number) => Math.round(value / 5) * 5;

/**
 * "Il tuo fabbisogno" (Piano): GET /api/needs (four Nutrition reads, cached 30 s), the form, applying a goal and
 * the AI opinion (/api/needs/ai, part Pasti da foto). Rules in docs/needs.md.
 */
export const needsRoutes: FastifyPluginAsync<NeedsRoutesOptions> = async (app, { api, store, health, gym, advisor, aiEnabled = () => true, requireOwner }) => {
  app.addHook("preHandler", requireOwner);

  const aiAvailable = () => Boolean(advisor) && aiEnabled();

  async function prefill(today: string): Promise<NeedsView["prefill"]> {
    const steps = health?.daily(addDaysTo(today, -PREFILL_STEP_DAYS), addDaysTo(today, -1), ["steps"]) ?? [];
    const stepsPerDay = steps.length ? Math.round(steps.reduce((s, d) => s + d.value, 0) / steps.length / 100) * 100 : null;
    let trainingPerWeek: number | null = null;
    let trainingMinutes: number | null = null;
    const source = gym?.();
    if (source) {
      try {
        const workouts = await source.workoutsSince(`${addDaysTo(today, -PREFILL_WORKOUT_DAYS)}T00:00:00Z`);
        trainingPerWeek = Math.round((workouts.length / PREFILL_WORKOUT_DAYS) * 7);
        const minutes = workouts.map((w) => (Date.parse(w.end_time) - Date.parse(w.start_time)) / 60_000).filter((m) => m > 0 && m < 300);
        trainingMinutes = minutes.length ? round5(minutes.reduce((s, m) => s + m, 0) / minutes.length) : null;
      } catch (error) {
        if (!isGymUnavailable(error)) throw error;
      }
    }
    return { stepsPerDay, trainingPerWeek, trainingMinutes };
  }

  async function view(): Promise<NeedsView> {
    const today = (await api.clock()).localDate;
    const [goals, weight, summary] = await Promise.all([
      api.goals(),
      api.weightTrends(WEIGHT_DAYS, today),
      api.summary(addDaysTo(today, -NEEDS_CHECK.windowDays), addDaysTo(today, -1)),
    ]);
    const toKg = weightUnitOf(weight.unit) === "lb" ? LB_TO_KG : 1;
    const weights = weight.entries.map((e) => ({ date: e.date, weightKg: e.weight * toKg }));
    const latest = weights.at(-1);
    const weightKg = latest ? Math.round(latest.weightKg * 10) / 10 : null;
    const stored = store.get();
    const profile = stored.profile;
    const check = checkNeeds({
      today,
      days: summary.days,
      weights,
      goal: profile?.goal ?? "maintain",
      pace: profile?.pace ?? "steady",
      goalKcal: goals.kcal,
      floorKcal: profile && weightKg ? kcalFloor(profile, weightKg) : NEEDS_LIMITS.minKcal.female,
    });
    // The source is shown only while Nutrition still has the applied calories and protein
    const applied = stored.applied && stored.applied.targets.kcal === goals.kcal && stored.applied.targets.protein === goals.protein ? { source: stored.applied.source, at: stored.applied.at } : null;
    return {
      today,
      weightKg,
      profile,
      result: profile && weightKg ? computeNeeds(profile, weightKg) : null,
      goals: { kcal: goals.kcal, protein: goals.protein, carbs: goals.carbs, fat: goals.fat },
      applied,
      check,
      ai: aiAvailable() ? stored.ai : null,
      aiAvailable: aiAvailable(),
      prefill: profile ? { stepsPerDay: null, trainingPerWeek: null, trainingMinutes: null } : await prefill(today),
    };
  }

  app.get("/needs", async () => view());

  app.put("/needs/profile", async (request, reply) => {
    const body = needsProfileSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_profile" });
    store.setProfile(body.data);
    return view();
  });

  // Sets the goals in Nutrition; whatever the source, never under the floor and with protein and fat in range
  app.post("/needs/apply", async (request, reply) => {
    const body = applySchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_targets" });
    const { profile } = store.get();
    const today = (await api.clock()).localDate;
    const weight = await api.weightTrends(WEIGHT_DAYS, today);
    const last = weight.entries.at(-1);
    if (!profile || !last) return reply.code(409).send({ error: "needs_profile" });
    const weightKg = last.weight * (weightUnitOf(weight.unit) === "lb" ? LB_TO_KG : 1);
    const { targets } = body.data;
    const safe =
      targets.kcal >= kcalFloor(profile, weightKg) &&
      targets.protein >= NEEDS_LIMITS.proteinGPerKg.min * weightKg - 5 &&
      targets.protein <= NEEDS_LIMITS.proteinGPerKg.max * weightKg + 5 &&
      targets.fat >= NEEDS_LIMITS.fatMinGPerKg * weightKg - 5;
    if (!safe) return reply.code(400).send({ error: "unsafe_targets" });
    const rounded = { kcal: targets.kcal, protein: Math.round(targets.protein), carbs: Math.round(targets.carbs), fat: Math.round(targets.fat) };
    await api.setGoals(rounded);
    store.setApplied(body.data.source, rounded, new Date().toISOString());
    return { ok: true };
  });

  // "Chiedi un parere all'IA": under /needs/ai, so it is hidden with Pasti da foto
  app.post("/needs/ai", async (request, reply) => {
    if (!advisor) return reply.code(503).send({ error: "recognition_not_configured" });
    const current = await view();
    if (!current.profile || !current.result || current.weightKg === null) return reply.code(409).send({ error: "needs_profile" });
    try {
      const opinion = await advisor.advise({ profile: current.profile, weightKg: current.weightKg, standard: current.result, check: current.check });
      store.setAi(opinion);
      return opinion;
    } catch (error) {
      if (!(error instanceof RecognitionError)) throw error;
      request.log.warn({ reason: error.reason }, error.message);
      return reply.code(RECOGNITION_STATUS[error.reason]).send({ error: `recognition_${error.reason}` });
    }
  });
};
