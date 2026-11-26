import { readFileSync } from "node:fs";
import { addCourse, splitMeal, mealPlanSchema, type Dish, type MealPlan } from "@intake/shared";
import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { openDatabase } from "../src/db/database.js";
import { DishGroupStore } from "../src/db/dishGroupStore.js";
import { PlanStore } from "../src/db/planStore.js";
import { logPlannedMeal, PlanMealNotFoundError, PlanMealWithoutMacrosError } from "../src/services/logPlanned.js";
import { authOptions, signIn } from "./helpers.js";

const examplePlan: MealPlan = mealPlanSchema.parse(
  JSON.parse(readFileSync(new URL("../../../examples/meal-plan.example.json", import.meta.url), "utf8")),
);

const salmon: Dish = {
  name: "Pasta al salmone",
  aliases: [],
  foods: [
    { name: "Pasta", quantity: 100, unit: "g", nutrients: { kcal: 350, protein: 12, carbs: 70, fat: 2, fiber: 3 } },
    { name: "Salmone affumicato", quantity: 80, unit: "g", nutrients: { kcal: 150, protein: 20, carbs: 0, fat: 8, fiber: 0 } },
  ],
  macros: null,
};
const dish = (name: string): Dish => ({ name, aliases: [], foods: [{ name }], macros: { kcal: 500, protein: 30, carbs: 50, fat: 15, fiber: 4 } });

describe("DishGroupStore", () => {
  it("links dishes, merges groups and drops a group left with one dish", () => {
    const store = new DishGroupStore(openDatabase(":memory:"));
    const first = store.link({ dish: dish("Pasta con tonno"), alternative: dish("Pasta al salmone") });
    store.link({ dish: dish("Riso e pollo"), alternative: dish("Farro e pollo") });
    store.link({ dish: dish("pasta al salmone"), alternative: dish("Riso e pollo") });
    const groups = store.list();
    expect(groups).toHaveLength(1);
    expect(groups[0]!.id).toBe(first.id);
    expect(groups[0]!.dishes.map((d) => d.name)).toEqual(["Pasta con tonno", "Pasta al salmone", "Riso e pollo", "Farro e pollo"]);
    store.update(first.id, [dish("Pasta con tonno")]);
    expect(store.list()).toEqual([]);
  });
});

describe("dish group routes", () => {
  const api = {
    clock: async () => ({ localDate: "2026-11-05", localTime: "12:00", timezone: "Europe/Rome", timezoneSet: true }),
    logMeal: vi.fn(async () => ({ id: "m1" })),
    mealsByDate: async () => ({ timezone: null, meals: [] }),
  } as never;

  it("are owner-only and validated, and keep groups across requests", async () => {
    const db = openDatabase(":memory:");
    const app = await buildApp({ auth: authOptions(), api, plans: new PlanStore(db), dishGroups: new DishGroupStore(db) });
    expect((await app.inject({ method: "GET", url: "/api/dish-groups" })).statusCode).toBe(401);
    const headers = { cookie: (await signIn(app)).cookie };
    const linked = await app.inject({ method: "POST", url: "/api/dish-groups/link", headers, payload: { dish: dish("A"), alternative: dish("B") } });
    expect(linked.json().groups[0].dishes.map((d: Dish) => d.name)).toEqual(["A", "B"]);
    const id = linked.json().groups[0].id;
    expect((await app.inject({ method: "POST", url: "/api/dish-groups/link", headers, payload: { dish: { name: "" } } })).statusCode).toBe(400);
    const renamed = await app.inject({ method: "PUT", url: `/api/dish-groups/${id}`, headers, payload: { dishes: [{ ...dish("A"), aliases: ["A bis"] }, dish("B")] } });
    expect(renamed.json().groups[0].dishes[0].aliases).toEqual(["A bis"]);
    expect((await app.inject({ method: "PUT", url: "/api/dish-groups/999", headers, payload: { dishes: [dish("A")] } })).statusCode).toBe(404);
    expect((await app.inject({ method: "DELETE", url: `/api/dish-groups/${id}`, headers })).json()).toEqual({ groups: [] });
  });

  it("links the alternatives of an uploaded Claude Fitness plan, once however many times it is uploaded", async () => {
    const db = openDatabase(":memory:");
    const groups = new DishGroupStore(db);
    const app = await buildApp({ auth: authOptions(), api, plans: new PlanStore(db), dishGroups: groups });
    const headers = { cookie: (await signIn(app)).cookie };
    const cf = JSON.parse(readFileSync(new URL("../../../examples/claude-fitness-plan.example.json", import.meta.url), "utf8"));
    expect((await app.inject({ method: "POST", url: "/api/plans", headers, payload: cf })).statusCode).toBe(201);
    expect((await app.inject({ method: "POST", url: "/api/plans", headers, payload: cf })).statusCode).toBe(201);
    expect(groups.list()).toHaveLength(1);
    expect(groups.list()[0]!.dishes.map((d) => d.name)[1]).toBe("Pasta 100 g + Pomodoro/passata + Polpette di carne magra al forno 150 g");
  });
});

describe("logPlannedMeal with an alternative", () => {
  function setup() {
    const db = openDatabase(":memory:");
    const plans = new PlanStore(db);
    const plan = plans.add({ ...examplePlan, validFrom: "2026-11-02" });
    const groups = new DishGroupStore(db);
    const logMeal = vi.fn(async (_input: object) => ({ id: "alt-meal" }));
    const api = { logMeal, mealsByDate: vi.fn(async () => ({ timezone: null, meals: [] })) };
    return { plans, plan, groups, logMeal, api };
  }

  it("logs the chosen dish with its foods, its own idempotency key, and links it to the planned meal", async () => {
    const { plans, plan, groups, logMeal, api } = setup();
    const group = groups.link({ dish: dish("Pasta al ragù magro di manzo 100 g + Insalata"), alternative: salmon });
    await logPlannedMeal(
      api,
      plans,
      { date: "2026-11-05", planId: plan.id, index: 2, today: "2026-11-06", now: "09:00:00", alternative: { groupId: group.id, dishIndex: 1 } },
      groups,
    );
    const call = logMeal.mock.calls[0]![0] as Record<string, unknown>;
    expect(call.description).toBe("Pranzo: Pasta al salmone");
    expect(call.meal_type).toBe("lunch");
    expect((call.items as unknown[]).length).toBe(2);
    expect(call.logged_at).toBe("2026-11-05T13:00");
    expect(call.idempotency_key).toBe(`intake-plan-${plan.id}-2026-11-05-2-alt-${group.id}-1`);
    expect(plans.linksOn("2026-11-05")).toEqual([{ planId: plan.id, index: 2, mealId: "alt-meal" }]);
  });

  it("refuses a dish of a group the planned dish is not in", async () => {
    const { plans, plan, groups, api } = setup();
    const other = groups.link({ dish: dish("Frittata"), alternative: salmon });
    await expect(
      logPlannedMeal(
        api,
        plans,
        { date: "2026-11-05", planId: plan.id, index: 2, today: "2026-11-06", now: "09:00:00", alternative: { groupId: other.id, dishIndex: 1 } },
        groups,
      ),
    ).rejects.toBeInstanceOf(PlanMealNotFoundError);
  });
});

describe("logPlannedMeal with courses", () => {
  it("logs only the courses eaten, one of them as its alternative, as one meal", async () => {
    const db = openDatabase(":memory:");
    const plans = new PlanStore(db);
    const index = examplePlan.days.thursday.meals.findIndex((m) => m.title === "Pranzo");
    const first = examplePlan.days.thursday.meals[index]!;
    const pasta = { name: "Pasta", quantity: 100, unit: "g", nutrients: { kcal: 350, protein: 12, carbs: 70, fat: 2, fiber: 3 } };
    const yogurt = { name: "Yogurt greco", quantity: 150, unit: "g", nutrients: { kcal: 90, protein: 15, carbs: 6, fat: 0, fiber: 0 } };
    let withCourses = { ...examplePlan, days: { ...examplePlan.days, thursday: { ...examplePlan.days.thursday, meals: examplePlan.days.thursday.meals.map((m, i) => (i === index ? { title: first.title, time: first.time, foods: [pasta], description: "Pasta con tonno" } : m)) } } } as MealPlan;
    withCourses = addCourse(mealPlanSchema.parse(withCourses), { day: "thursday", index, name: "Fine pasto", firstName: "Primo", description: "Yogurt greco", foods: [yogurt] });
    const plan = plans.add({ ...withCourses, validFrom: "2026-11-02" });
    const groups = new DishGroupStore(db);
    const group = groups.link({ dish: dish("Pasta con tonno"), alternative: salmon });
    const logMeal = vi.fn(async (_input: object) => ({ id: "c-meal" }));
    const api = { logMeal, mealsByDate: vi.fn(async () => ({ timezone: null, meals: [] })) };
    await logPlannedMeal(
      api,
      plans,
      { date: "2026-11-05", planId: plan.id, index, today: "2026-11-06", now: "09:00:00", courses: [{ eaten: true, alternative: { groupId: group.id, dishIndex: 1 } }, { eaten: false }] },
      groups,
    );
    const call = logMeal.mock.calls[0]![0] as Record<string, unknown>;
    expect(call.description).toBe("Pranzo: Pasta al salmone");
    expect((call.items as Array<{ name: string }>).map((i) => i.name)).toEqual(["Pasta", "Salmone affumicato"]);
    expect(call.idempotency_key).toBe(`intake-plan-${plan.id}-2026-11-05-${index}-c-${group.id}.1_x`);
    expect(plans.linksOn("2026-11-05")).toEqual([{ planId: plan.id, index, mealId: "c-meal" }]);
    await expect(logPlannedMeal(api, plans, { date: "2026-11-05", planId: plan.id, index, today: "2026-11-06", now: "09:00:00", courses: [{ eaten: false }, { eaten: false }] }, groups)).rejects.toBeInstanceOf(PlanMealNotFoundError);
  });

  it("logs a meal split from totals only with its totals when every course is eaten as planned", async () => {
    const db = openDatabase(":memory:");
    const plans = new PlanStore(db);
    const index = examplePlan.days.thursday.meals.findIndex((m) => m.title === "Pranzo");
    const first = examplePlan.days.thursday.meals[index]!;
    const meal = { title: first.title, time: first.time, foods: [{ name: "Pasta", quantity: 100, unit: "g" }, { name: "Yogurt", quantity: 150, unit: "g" }], macros: { kcal: 520, protein: 25, carbs: 80, fat: 8, fiber: 3 } };
    const base = mealPlanSchema.parse({ ...examplePlan, days: { ...examplePlan.days, thursday: { ...examplePlan.days.thursday, meals: examplePlan.days.thursday.meals.map((m, i) => (i === index ? meal : m)) } } });
    const split = splitMeal(base, { day: "thursday", index, labels: ["Primo", "Fine pasto"] });
    const plan = plans.add({ ...split, validFrom: "2026-11-02" });
    const logMeal = vi.fn(async (_input: object) => ({ id: "t-meal" }));
    const api = { logMeal, mealsByDate: vi.fn(async () => ({ timezone: null, meals: [] })) };
    await logPlannedMeal(api, plans, { date: "2026-11-05", planId: plan.id, index, today: "2026-11-06", now: "09:00:00", courses: [{ eaten: true }, { eaten: true }] });
    expect((logMeal.mock.calls[0]![0] as Record<string, unknown>).calories).toBe(520);
    await expect(logPlannedMeal(api, plans, { date: "2026-11-05", planId: plan.id, index, today: "2026-11-06", now: "09:00:00", courses: [{ eaten: true }, { eaten: false }] })).rejects.toBeInstanceOf(PlanMealWithoutMacrosError);
  });
});
