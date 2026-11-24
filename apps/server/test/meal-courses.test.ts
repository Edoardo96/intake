import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { openDatabase } from "../src/db/database.js";
import { MealCourseStore } from "../src/db/mealCourseStore.js";
import type { MealRoutesOptions } from "../src/routes/meals.js";
import { authOptions, signIn } from "./helpers.js";

const ID = "3f2b9c1e-1111-4222-8333-944455556666";
const api = {
  clock: async () => ({ timezone: "Europe/Rome", localDate: "2026-11-24", localTime: "13:00:00", utc: "" }),
  mealsByDate: async () => ({ timezone: null, meals: [] }),
  mealsByRange: async () => ({ timezone: null, meals: [] }),
  logMeal: vi.fn(async () => ({ id: ID })),
  updateMeal: vi.fn(async () => {}),
  deleteMeal: async () => {},
  saveMeal: async () => {},
  savedMeals: async () => [],
  logSavedMeal: async () => ({ id: null }),
  deleteSavedMeal: async () => true,
} satisfies MealRoutesOptions["api"];

const n = (kcal: number) => ({ kcal, protein: 1, carbs: 1, fat: 1, fiber: null, sugar: null, addedSugar: null, saturatedFat: null, transFat: null, alcohol: null, caffeineMg: null, sodiumMg: null });
const item = (name: string, kcal: number) => ({ name, quantity: 100, unit: "g", nutrients: n(kcal) });
const meal = { date: "2026-11-24", time: "13:00", type: "lunch", description: "Tagliere + Tagliatelle + Tiramisù", items: [item("Salame", 200), item("Tagliatelle", 400), item("Ragù", 200), item("Tiramisù", 300)] };

describe("meal courses", () => {
  it("keeps the courses of a logged meal, changes or drops them in Modifica pasto, and forgets them with the meal", async () => {
    const store = new MealCourseStore(openDatabase(":memory:"));
    const app = await buildApp({ auth: authOptions(), mealsApi: api, mealCourses: store });
    const headers = { cookie: (await signIn(app)).cookie };
    const courses = [
      { name: "Antipasto", count: 1 },
      { name: "Primo", count: 2 },
      { name: "Dolce", count: 1 },
    ];
    expect((await app.inject({ method: "POST", url: "/api/meals", headers, payload: { ...meal, idempotencyKey: "k-12345678", courses: courses.slice(0, 2) } })).statusCode).toBe(400);
    const ok = await app.inject({ method: "POST", url: "/api/meals", headers, payload: { ...meal, idempotencyKey: "k-12345678", courses } });
    expect([ok.statusCode, ok.body]).toEqual([201, expect.any(String)]);
    expect((await app.inject({ method: "GET", url: `/api/meals/${ID}/courses`, headers })).json()).toEqual({ courses });

    // Without the field the courses stay; with null the meal is one dish again
    expect((await app.inject({ method: "PATCH", url: `/api/meals/${ID}`, headers, payload: meal })).statusCode).toBe(200);
    expect(store.get(ID)).toEqual(courses);
    const two = { ...meal, items: meal.items.slice(0, 3), courses: [{ name: "Antipasto", count: 1 }, { name: "Primo", count: 2 }] };
    expect((await app.inject({ method: "PATCH", url: `/api/meals/${ID}`, headers, payload: two })).statusCode).toBe(200);
    expect(store.get(ID)).toEqual(two.courses);
    expect((await app.inject({ method: "PATCH", url: `/api/meals/${ID}`, headers, payload: { ...meal, courses: null } })).statusCode).toBe(200);
    expect(store.get(ID)).toBeNull();

    store.set(ID, courses);
    await app.inject({ method: "DELETE", url: `/api/meals/${ID}`, headers });
    expect(store.get(ID)).toBeNull();
  });
});
