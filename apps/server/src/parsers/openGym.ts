import { z } from "zod";

/**
 * openGym (self-hosted gym tracker, https://opengym.ch/api.html). Two read paths with one scoped token:
 * the raw app state (GET /api/token/data) for workout times, and the MCP tools for what openGym computes
 * (week plan, the session a routine opens with after progression, muscle balance). Only used fields are validated.
 */

const setSchema = z.looseObject({
  w: z.number().nullable().optional(),
  r: z.number().nullable().optional(),
  done: z.boolean().optional(),
  phase: z.string().optional(),
  rpe: z.number().nullable().optional(),
});

export const openGymWorkoutSchema = z.looseObject({
  id: z.string(),
  d: z.string(),
  /** Epoch milliseconds. */
  start: z.number(),
  end: z.number(),
  routineId: z.string().nullable().optional(),
  name: z.string().default(""),
  entries: z.array(z.looseObject({ id: z.string(), sets: z.array(setSchema).default([]) })).default([]),
});

export const openGymStateSchema = z.looseObject({
  state: z.looseObject({
    unit: z.string().default("kg"),
    week: z.record(z.string(), z.array(z.string())).nullable().optional(),
    routines: z
      .array(z.looseObject({ id: z.string(), name: z.string().default(""), ex: z.array(z.looseObject({ id: z.string() })).default([]) }))
      .default([]),
    customEx: z.record(z.string(), z.looseObject({ id: z.string(), n: z.string().optional() })).nullable().optional(),
    workouts: z.record(z.string(), z.unknown()).default({}),
  }),
  rev: z.number().optional(),
});

export const weekPlanSchema = z.looseObject({
  today: z.string(),
  days: z.array(
    z.looseObject({
      date: z.string(),
      routine_ids: z.array(z.string()).default([]),
      routine_names: z.array(z.string()).default([]),
      planned_by: z.string().optional(),
    }),
  ),
});

const openingSetSchema = z.looseObject({ phase: z.string().optional(), w: z.number().nullable().optional(), r: z.number().nullable().optional() });

export const previewSchema = z.looseObject({
  date: z.string(),
  routine_id: z.string(),
  routine_name: z.string(),
  unit: z.string().default("kg"),
  exercises: z.array(
    z.looseObject({
      id: z.string(),
      name: z.string(),
      mode: z.string().optional(),
      planned: z.looseObject({ sets: z.number().optional(), reps: z.number().optional(), weight: z.number().nullable().optional(), summary: z.string().optional() }).optional(),
      prescription: z.looseObject({ kind: z.string().optional(), weight: z.number().nullable().optional(), reps: z.number().nullable().optional(), why: z.string().optional() }).optional(),
      opening_sets: z.array(openingSetSchema).default([]),
      differs_from_plan: z.boolean().optional(),
    }),
  ),
});

export const workoutDetailSchema = z.looseObject({
  id: z.string(),
  entries: z.array(z.looseObject({ id: z.string(), name: z.string() })).default([]),
});

export const routineDetailSchema = z.looseObject({
  id: z.string(),
  name: z.string().default(""),
  exercises: z.array(z.looseObject({ id: z.string(), name: z.string() })).default([]),
});

export const muscleBalanceSchema = z.looseObject({
  worked: z.array(z.looseObject({ slug: z.string(), name: z.string(), level: z.number() })).default([]),
  neglected: z.array(z.looseObject({ slug: z.string(), name: z.string() })).default([]),
});

export type OpenGymState = z.infer<typeof openGymStateSchema>["state"];
export type OpenGymWorkout = z.infer<typeof openGymWorkoutSchema>;
export type OpenGymWeekPlan = z.infer<typeof weekPlanSchema>;
export type OpenGymPreview = z.infer<typeof previewSchema>;
export type OpenGymMuscleBalance = z.infer<typeof muscleBalanceSchema>;

/** Valid workouts of the state, newest first; malformed entries are skipped. */
export function openGymWorkouts(state: OpenGymState): OpenGymWorkout[] {
  return Object.values(state.workouts)
    .flatMap((raw) => {
      const parsed = openGymWorkoutSchema.safeParse(raw);
      return parsed.success ? [parsed.data] : [];
    })
    .sort((a, b) => b.start - a.start);
}
