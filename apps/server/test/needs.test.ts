import { describe, expect, it, vi } from "vitest";
import { addDaysTo, type NeedsProfile } from "@intake/shared";
import { buildApp } from "../src/app.js";
import { openDatabase } from "../src/db/database.js";
import { FeatureStore } from "../src/db/featureStore.js";
import { NeedsStore } from "../src/db/needsStore.js";
import type { NeedsRoutesOptions } from "../src/routes/needs.js";
import { RecognitionError } from "../src/services/mealRecognition.js";
import { NeedsAdvisor } from "../src/services/needsAdvisor.js";
import { authOptions, signIn } from "./helpers.js";

const today = "2026-11-20";
const limits = { saturatedFat: null, sugar: null, addedSugar: null, alcohol: null, caffeineMg: null, sodiumMg: null };
const profile: NeedsProfile = {
  sex: "male",
  age: 30,
  heightCm: 180,
  job: "seated",
  stepsPerDay: 8000,
  trainingPerWeek: 4,
  trainingType: "weights",
  trainingMinutes: 60,
  goal: "cut",
  pace: "steady",
  notes: "",
};

function fakeApi(overrides: Partial<NeedsRoutesOptions["api"]> = {}): NeedsRoutesOptions["api"] {
  return {
    clock: async () => ({ timezone: "Europe/Rome", localDate: today, localTime: "09:00:00", utc: "" }),
    goals: async () => ({ kcal: 2200, protein: 150, carbs: 250, fat: 70, fiber: 30, waterMl: 2500, limits, targetWeight: null }),
    weightTrends: async () => ({ unit: "kg", target: null, entries: [0, 7, 14, 20].map((d) => ({ date: addDaysTo(today, -21 + d), weight: 80 - (0.5 * d) / 7 })) }),
    summary: async () => ({
      goals: { kcal: 2200, protein: 150, fiber: 30, waterMl: 2500 },
      days: Array.from({ length: 21 }, (_, i) => ({ date: addDaysTo(today, -21 + i), kcal: 2200, protein: 150, carbs: 250, fat: 70, fiber: 25, waterMl: 2000, mealCount: 4 })),
    }),
    setGoals: async () => {},
    ...overrides,
  };
}

async function signedIn(options: Partial<Omit<NeedsRoutesOptions, "requireOwner">> = {}) {
  const db = openDatabase(":memory:");
  const store = new NeedsStore(db);
  const features = new FeatureStore(db);
  const app = await buildApp({
    auth: authOptions(),
    needs: { api: fakeApi(), store, ...options },
    features: { features, gymApps: { hevy: false, opengym: false }, recognition: true },
  });
  const { cookie } = await signIn(app);
  return { app, store, features, headers: { cookie } };
}

describe("needs routes", () => {
  it("answers without a profile with the data check and the prefill from Health and the gym app", async () => {
    const workouts = [1, 5, 9, 12, 16, 20, 23, 26].map((d) => ({ start_time: `${addDaysTo(today, -d)}T18:00:00Z`, end_time: `${addDaysTo(today, -d)}T19:10:00Z` }));
    const { app, headers } = await signedIn({
      health: { daily: () => [{ date: "2026-11-18", metric: "steps", value: 9120 }, { date: "2026-11-19", metric: "steps", value: 7020 }] },
      gym: () => ({ id: "hevy", label: "Hevy", hevy: {} as never, workoutsSince: async () => workouts as never }),
    });
    const view = (await app.inject({ method: "GET", url: "/api/needs", headers })).json();
    expect(view.profile).toBeNull();
    expect(view.result).toBeNull();
    expect(view.weightKg).toBeCloseTo(78.6, 1);
    expect(view.prefill).toEqual({ stepsPerDay: 8100, trainingPerWeek: 2, trainingMinutes: 70 });
    expect(view.check).toMatchObject({ status: "ok", maintenance: 2750, loggedDays: 21 });
    expect(view.aiAvailable).toBe(false);
  });

  it("saves the profile and returns the calculation", async () => {
    const { app, headers, store } = await signedIn();
    const res = await app.inject({ method: "PUT", url: "/api/needs/profile", headers, payload: profile });
    expect(res.statusCode).toBe(200);
    expect(res.json().result).toMatchObject({ bmr: expect.any(Number), kcal: expect.any(Number) });
    expect(store.get().profile).toEqual(profile);
    expect((await app.inject({ method: "PUT", url: "/api/needs/profile", headers, payload: { ...profile, age: 12 } })).statusCode).toBe(400);
  });

  it("applies goals within the safety limits and remembers where they came from", async () => {
    let goals = { kcal: 2200, protein: 150, carbs: 250, fat: 70, fiber: 30, waterMl: 2500, limits, targetWeight: null };
    const setGoals = vi.fn(async (update: Partial<typeof goals>) => void (goals = { ...goals, ...update }));
    const { app, headers, store } = await signedIn({ api: fakeApi({ setGoals, goals: async () => goals }) });
    expect((await app.inject({ method: "POST", url: "/api/needs/apply", headers, payload: { source: "standard", targets: { kcal: 2080, protein: 175, carbs: 210, fat: 60 } } })).statusCode).toBe(409);

    store.setProfile(profile);
    const tooLow = await app.inject({ method: "POST", url: "/api/needs/apply", headers, payload: { source: "ai", targets: { kcal: 1200, protein: 175, carbs: 50, fat: 40 } } });
    expect(tooLow.statusCode).toBe(400);
    const ok = await app.inject({ method: "POST", url: "/api/needs/apply", headers, payload: { source: "standard", targets: { kcal: 2080, protein: 175, carbs: 210, fat: 60 } } });
    expect(ok.statusCode).toBe(200);
    expect(setGoals).toHaveBeenCalledWith({ kcal: 2080, protein: 175, carbs: 210, fat: 60 });
    expect((await app.inject({ method: "GET", url: "/api/needs", headers })).json().applied).toMatchObject({ source: "standard" });

    // Changed elsewhere (Profilo, a Claude chat): the source is no longer shown
    goals = { ...goals, kcal: 2300 };
    expect((await app.inject({ method: "GET", url: "/api/needs", headers })).json().applied).toBeNull();
  });

  it("asks the AI with the profile, the calculation and the check, and keeps its last opinion", async () => {
    const opinion = { at: "2026-11-20T09:00:00.000Z", model: "m", summary: "Ok.", targets: { kcal: 2300, protein: 170, carbs: 250, fat: 70 }, limited: false, tips: ["Bevi acqua."] };
    const advise = vi.fn(async () => opinion);
    const { app, headers, store, features } = await signedIn({ advisor: { advise }, aiEnabled: () => features.enabled("photoMeals") });
    features.set({ photoMeals: true });
    expect((await app.inject({ method: "POST", url: "/api/needs/ai", headers })).statusCode).toBe(409);

    store.setProfile(profile);
    const res = await app.inject({ method: "POST", url: "/api/needs/ai", headers });
    expect(res.json()).toEqual(opinion);
    const input = (advise.mock.calls[0] as unknown as [Record<string, any>])[0];
    expect(input.profile).toEqual(profile);
    expect(input.check.status).toBe("ok");
    expect(input.standard.kcal).toBeGreaterThan(0);
    expect((await app.inject({ method: "GET", url: "/api/needs", headers })).json()).toMatchObject({ aiAvailable: true, ai: opinion });

    advise.mockRejectedValueOnce(new RecognitionError("credit", "no credit"));
    expect((await app.inject({ method: "POST", url: "/api/needs/ai", headers })).json()).toEqual({ error: "recognition_credit" });

    // With Pasti da foto off the AI part is hidden; the calculation stays
    features.set({ photoMeals: false });
    expect((await app.inject({ method: "POST", url: "/api/needs/ai", headers })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/api/needs", headers })).json()).toMatchObject({ aiAvailable: false, ai: null });
  });
});

describe("NeedsAdvisor", () => {
  const standard = { kcal: 2080, protein: 175, carbs: 210, fat: 60, bmr: 1780, maintenance: 2450, weeklyChangeKg: -0.33, limited: false };
  const reply = (body: object, stop_reason = "end_turn") => ({ content: [{ type: "text", text: JSON.stringify(body) }], stop_reason, usage: { input_tokens: 900, output_tokens: 400 } });

  it("sends the data with a structured output and keeps the proposal inside the limits", async () => {
    const create = vi.fn(async () => reply({ summary: "Troppo basso.", kcal: 1300, protein: 180, carbs: 100, fat: 40, tips: ["a", "b"] }));
    const advisor = new NeedsAdvisor({ apiKey: "k", model: () => "claude-haiku-5-5", client: { create } as never, now: () => new Date("2026-11-20T09:00:00Z") });
    const opinion = await advisor.advise({ profile: { ...profile, notes: "lavoro a turni" }, weightKg: 80, standard, check: { status: "few_data", loggedDays: 3, weighIns: 1 } });
    expect(opinion).toMatchObject({ at: "2026-11-20T09:00:00.000Z", model: "claude-haiku-5-5", summary: "Troppo basso.", limited: true, tips: ["a", "b"] });
    expect(opinion.targets.kcal).toBe(1840);
    const sent = (create.mock.calls[0] as unknown as [Record<string, any>])[0];
    expect(sent.output_config.format.type).toBe("json_schema");
    expect(sent.messages[0].content).toContain("lavoro a turni");
    expect(sent.messages[0].content).toContain('"weightKg": 80');
  });

  it("turns a refusal and a bad answer into errors", async () => {
    const refusal = new NeedsAdvisor({ apiKey: "k", model: () => "m", client: { create: async () => reply({}, "refusal") } as never });
    await expect(refusal.advise({ profile, weightKg: 80, standard, check: { status: "few_data", loggedDays: 0, weighIns: 0 } })).rejects.toMatchObject({ reason: "refused" });
    const bad = new NeedsAdvisor({ apiKey: "k", model: () => "m", client: { create: async () => reply({ summary: "x" }) } as never });
    await expect(bad.advise({ profile, weightKg: 80, standard, check: { status: "few_data", loggedDays: 0, weighIns: 0 } })).rejects.toMatchObject({ reason: "unreadable" });
  });
});
