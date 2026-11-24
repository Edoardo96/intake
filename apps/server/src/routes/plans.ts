import { WEEKDAYS, addPlanMeal, mealAddSchema, mealRemoveSchema, mealRestoreSchema, removePlanMeal, restorePlanMeal, type PlanMealsChange, mealSplitSchema, splitMeal, addCourse, courseAddSchema, courseRemoveSchema, removeCourse, dishLinkSchema, importPlan, mealPlanSchema, plannedFoodSchema, editMeal, mealEditSchema, mealMoveSchema, mealTimeChangeSchema, setMealTime, swapMeals, type MealPlan, type PlanUploadError, type PlansResponse } from "@intake/shared";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import type { PlanStore } from "../db/planStore.js";
import type { DishGroupStore } from "../db/dishGroupStore.js";
import type { NutritionApi } from "../mcp/nutritionApi.js";

export interface PlanRoutesOptions {
  plans: PlanStore;
  api: Pick<NutritionApi, "clock">;
  /** Piatti intercambiabili: the alternatives of an uploaded Claude Fitness plan are linked here. */
  dishGroups?: Pick<DishGroupStore, "link">;
  requireOwner: preHandlerHookHandler;
}

const startSchema = z.object({ validFrom: z.iso.date() }).strict();
const splitConfirmSchema = z
  .object({ day: z.enum(WEEKDAYS), index: z.number().int().min(0).max(9), foods: z.array(plannedFoodSchema).min(1).max(20) })
  .strict();

/** Meal plan versions under /api/plans. */
export const planRoutes: FastifyPluginAsync<PlanRoutesOptions> = async (app, { plans, api, dishGroups, requireOwner }) => {
  app.addHook("preHandler", requireOwner);

  app.get("/plans", async (): Promise<PlansResponse> => {
    const today = (await api.clock()).localDate;
    return { active: plans.activeOn(today), versions: plans.versions(today), today };
  });

  app.get<{ Params: { id: string } }>("/plans/:id", async (request, reply) => {
    const plan = plans.get(Number(request.params.id));
    return plan ?? reply.code(404).send({ error: "Plan not found" });
  });

  // Piano: a scheduled version starts on another day, e.g. today ("Applica da oggi"); versions already in effect keep their date
  app.patch<{ Params: { id: string } }>("/plans/:id/start", async (request, reply) => {
    const stored = plans.get(Number(request.params.id));
    if (!stored) return reply.code(404).send({ error: "Plan not found" });
    const body = startSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_date" });
    const today = (await api.clock()).localDate;
    if (stored.validFrom <= today) return reply.code(409).send({ error: "plan_already_started" });
    const plan = { ...stored.plan, validFrom: body.data.validFrom };
    plans.update(stored.id, plan);
    return { ...stored, validFrom: body.data.validFrom, plan };
  });

  // Confirms the split: the foods of the meal get their values, the meal keeps its totals. Saved as the same version.
  app.patch<{ Params: { id: string } }>("/plans/:id/split-foods", async (request, reply) => {
    const stored = plans.get(Number(request.params.id));
    if (!stored) return reply.code(404).send({ error: "Plan not found" });
    const body = splitConfirmSchema.safeParse(request.body);
    const current = body.success ? stored.plan.days[body.data.day].meals[body.data.index] : undefined;
    if (!body.success || !current || current.free || body.data.foods.length !== current.foods.length) return reply.code(400).send({ error: "invalid_split" });
    const meals = stored.plan.days[body.data.day].meals.map((meal, i) => (i === body.data.index && !meal.free ? { ...meal, foods: body.data.foods } : meal));
    const plan = mealPlanSchema.parse({ ...stored.plan, days: { ...stored.plan.days, [body.data.day]: { ...stored.plan.days[body.data.day], meals } } });
    plans.update(stored.id, plan);
    return { ...stored, plan };
  });

  // Piano: a meal time changed on one day or on every day of a stored version (it stays the same version)
  app.patch<{ Params: { id: string } }>("/plans/:id/time", async (request, reply) => {
    const stored = plans.get(Number(request.params.id));
    if (!stored) return reply.code(404).send({ error: "Plan not found" });
    const body = mealTimeChangeSchema.safeParse(request.body);
    if (!body.success || !stored.plan.days[body.data.day].meals[body.data.index]) return reply.code(400).send({ error: "invalid_time" });
    const plan = setMealTime(stored.plan, body.data.day, body.data.index, body.data.time, body.data.allDays);
    plans.update(stored.id, plan);
    return { ...stored, plan };
  });

  // Piano: a dish swapped with the same meal of another day (the version stays the same)
  app.patch<{ Params: { id: string } }>("/plans/:id/swap", async (request, reply) => {
    const stored = plans.get(Number(request.params.id));
    if (!stored) return reply.code(404).send({ error: "Plan not found" });
    const body = mealMoveSchema.safeParse(request.body);
    if (!body.success || body.data.day === body.data.toDay || !stored.plan.days[body.data.day].meals[body.data.index]) return reply.code(400).send({ error: "invalid_move" });
    const plan = swapMeals(stored.plan, body.data.day, body.data.index, body.data.toDay);
    plans.update(stored.id, plan);
    return { ...stored, plan };
  });

  // Piano: one dish edited by hand (text, foods, main nutrients); the version stays the same
  app.patch<{ Params: { id: string } }>("/plans/:id/meal", async (request, reply) => {
    const stored = plans.get(Number(request.params.id));
    if (!stored) return reply.code(404).send({ error: "Plan not found" });
    const body = mealEditSchema.safeParse(request.body);
    if (!body.success || !stored.plan.days[body.data.day].meals[body.data.index]) return reply.code(400).send({ error: "invalid_meal" });
    let plan;
    try {
      plan = editMeal(stored.plan, body.data);
    } catch {
      return reply.code(400).send({ error: "invalid_meal" });
    }
    plans.update(stored.id, plan);
    return { ...stored, plan };
  });

  // "+ Aggiungi portata" and the × of a course (docs/courses.md)
  app.post<{ Params: { id: string } }>("/plans/:id/course", async (request, reply) => {
    const stored = plans.get(Number(request.params.id));
    if (!stored) return reply.code(404).send({ error: "Plan not found" });
    const body = courseAddSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_meal" });
    let plan;
    try {
      plan = addCourse(stored.plan, body.data);
    } catch {
      return reply.code(400).send({ error: "invalid_meal" });
    }
    plans.update(stored.id, plan);
    return { ...stored, plan };
  });

  // "Togli pasto", "Rimetti" and "+ Aggiungi pasto" (docs/plan-meals.md). They move the meals of a day, so a version
  // already in effect is not changed: the change becomes a new version from today, and today's links and skips follow
  // the meals to their new positions. A version that starts today or later is changed in place.
  const changeMeals = (parse: (body: unknown) => ((plan: MealPlan) => PlanMealsChange) | null) =>
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const stored = plans.get(Number(request.params.id));
      if (!stored) return reply.code(404).send({ error: "Plan not found" });
      const change = parse(request.body);
      if (!change) return reply.code(400).send({ error: "invalid_meal" });
      const today = (await api.clock()).localDate;
      const active = plans.activeOn(today);
      if (stored.validFrom <= today && active?.id !== stored.id) return reply.code(409).send({ error: "plan_superseded" });
      let result: PlanMealsChange;
      try {
        result = change(stored.plan);
      } catch {
        return reply.code(400).send({ error: "invalid_meal" });
      }
      if (stored.validFrom >= today) {
        plans.update(stored.id, result.plan);
        plans.moveRefs(stored.id, stored.id, today, result.maps);
        return { ...stored, plan: result.plan };
      }
      const next = plans.add({ ...result.plan, validFrom: today });
      plans.moveRefs(stored.id, next.id, today, result.maps);
      return next;
    };
  app.post<{ Params: { id: string } }>("/plans/:id/meals/remove", changeMeals((body) => {
    const input = mealRemoveSchema.safeParse(body);
    return input.success ? (plan) => removePlanMeal(plan, input.data) : null;
  }));
  app.post<{ Params: { id: string } }>("/plans/:id/meals/restore", changeMeals((body) => {
    const input = mealRestoreSchema.safeParse(body);
    return input.success ? (plan) => restorePlanMeal(plan, input.data) : null;
  }));
  app.post<{ Params: { id: string } }>("/plans/:id/meals/add", changeMeals((body) => {
    const input = mealAddSchema.safeParse(body);
    return input.success ? (plan) => addPlanMeal(plan, input.data) : null;
  }));

  // "Dividi in portate": the course of each food of a meal
  app.post<{ Params: { id: string } }>("/plans/:id/split", async (request, reply) => {
    const stored = plans.get(Number(request.params.id));
    if (!stored) return reply.code(404).send({ error: "Plan not found" });
    const body = mealSplitSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_meal" });
    let plan;
    try {
      plan = splitMeal(stored.plan, body.data);
    } catch {
      return reply.code(400).send({ error: "invalid_meal" });
    }
    plans.update(stored.id, plan);
    return { ...stored, plan };
  });

  app.post<{ Params: { id: string } }>("/plans/:id/course/remove", async (request, reply) => {
    const stored = plans.get(Number(request.params.id));
    if (!stored) return reply.code(404).send({ error: "Plan not found" });
    const body = courseRemoveSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_meal" });
    let plan;
    try {
      plan = removeCourse(stored.plan, body.data);
    } catch {
      return reply.code(400).send({ error: "invalid_meal" });
    }
    plans.update(stored.id, plan);
    return { ...stored, plan };
  });

  // Plans are generated by Claude Fitness and uploaded as JSON (well under the default 1 MB body limit).
  // Both the Claude Fitness format and Intake's own format are accepted.
  app.post("/plans", async (request, reply) => {
    const result = importPlan(request.body);
    if (!result.success) {
      const body: PlanUploadError = { error: "invalid_plan", issues: result.issues };
      return reply.code(400).send(body);
    }
    const stored = plans.add(result.plan);
    for (const link of result.links) {
      const valid = dishLinkSchema.safeParse(link);
      if (valid.success) dishGroups?.link(valid.data);
    }
    return reply.code(201).send(stored);
  });
};
