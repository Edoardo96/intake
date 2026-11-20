import { describe, expect, it } from "vitest";
import { addDaysTo, basalRate, checkNeeds, computeNeeds, kcalFloor, limitTargets, needsProfileSchema, type NeedsProfile } from "../src/needs.js";

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

describe("computeNeeds", () => {
  it("uses Mifflin-St Jeor", () => {
    expect(basalRate(profile, 80)).toBe(1780);
    expect(basalRate({ ...profile, sex: "female" }, 60)).toBe(10 * 60 + 6.25 * 180 - 150 - 161);
  });

  it("adds daily life, the steps above the job's and training, then the goal", () => {
    // 1780 × 1.2 + (8000 − 5000) × 0.0005 × 80 + 4 × 60 × 0.07 × 80 / 7 = 2136 + 120 + 192 = 2448
    const result = computeNeeds(profile, 80);
    expect(result).toMatchObject({ bmr: 1780, maintenance: 2450, kcal: 2080, protein: 175, fat: 60, carbs: 210, limited: false });
    expect(result.weeklyChangeKg).toBeCloseTo(-0.33, 2);
  });

  it("keeps the grams within the calories", () => {
    const r = computeNeeds({ ...profile, goal: "bulk", pace: "fast" }, 80);
    expect(Math.abs(r.protein * 4 + r.carbs * 4 + r.fat * 9 - r.kcal)).toBeLessThanOrEqual(25);
    expect(r.weeklyChangeKg).toBeGreaterThan(0);
  });

  it("never goes under the floor", () => {
    const small: NeedsProfile = { ...profile, sex: "female", age: 60, heightCm: 150, stepsPerDay: null, trainingPerWeek: 0, goal: "cut", pace: "fast" };
    const r = computeNeeds(small, 45);
    expect(r.kcal).toBe(1200);
    expect(r.limited).toBe(true);
    expect(kcalFloor(small, 45)).toBe(1200);
  });

  it("ignores steps when unknown and maintenance has no adjustment", () => {
    const r = computeNeeds({ ...profile, stepsPerDay: null, goal: "maintain" }, 80);
    expect(r.kcal).toBe(r.maintenance);
  });
});

describe("limitTargets", () => {
  it("raises calories that are too low and recomputes the carbs", () => {
    const { targets, limited } = limitTargets({ kcal: 1300, protein: 180, carbs: 100, fat: 40 }, profile, 80);
    expect(limited).toBe(true);
    expect(targets.kcal).toBe(1840); // 2448 × 0.75 = 1836 → 1840, above the 1780 floor
    expect(targets.fat).toBe(40);
    expect(targets.carbs).toBe((1840 - 180 * 4 - 40 * 9) / 4);
  });

  it("keeps a reasonable proposal", () => {
    const { targets, limited } = limitTargets({ kcal: 2100, protein: 170, carbs: 220, fat: 65 }, profile, 80);
    expect(limited).toBe(false);
    expect(targets).toMatchObject({ kcal: 2100, protein: 170, fat: 65 });
  });

  it("caps protein and calories that are too high", () => {
    const { targets, limited } = limitTargets({ kcal: 4000, protein: 400, carbs: 300, fat: 100 }, profile, 80);
    expect(limited).toBe(true);
    expect(targets.kcal).toBe(2940);
    expect(targets.protein).toBe(240);
  });
});

describe("checkNeeds", () => {
  const today = "2026-11-20";
  const days = Array.from({ length: 21 }, (_, i) => ({ date: addDaysTo(today, -21 + i), kcal: 2200, mealCount: 4 }));
  // Losing 0.5 kg a week over three weeks
  const weights = [0, 7, 14, 20].map((d) => ({ date: addDaysTo(today, -21 + d), weightKg: 80 - (0.5 * d) / 7 }));

  it("says there are too few data", () => {
    expect(checkNeeds({ today, days: days.slice(0, 5), weights, goal: "cut", pace: "steady", goalKcal: 2000, floorKcal: 1500 })).toEqual({ status: "few_data", loggedDays: 5, weighIns: 4 });
    expect(checkNeeds({ today, days, weights: weights.slice(0, 2), goal: "cut", pace: "steady", goalKcal: 2000, floorKcal: 1500 }).status).toBe("few_data");
  });

  it("finds the real maintenance from intake and the weight trend", () => {
    const check = checkNeeds({ today, days, weights, goal: "cut", pace: "steady", goalKcal: 2200, floorKcal: 1500 });
    expect(check.status).toBe("ok");
    if (check.status !== "ok") return;
    // 2200 + 0.5 / 7 × 7700 = 2750
    expect(check.maintenance).toBe(2750);
    expect(check.weeklyChangeKg).toBeCloseTo(-0.5, 2);
    expect(check.suggestedKcal).toBe(2340);
    expect(check.inLine).toBe(false);
    expect(check.loggedDays).toBe(21);
  });

  it("is in line within 100 kcal and leaves out today and partial days", () => {
    const withToday = [...days.map((d, i) => (i === 3 ? { ...d, kcal: 300 } : d)), { date: today, kcal: 500, mealCount: 1 }];
    const check = checkNeeds({ today, days: withToday, weights, goal: "cut", pace: "steady", goalKcal: 2300, floorKcal: 1500 });
    expect(check.status === "ok" && check.inLine).toBe(true);
    expect(check.status === "ok" && check.loggedDays).toBe(20);
  });
});

describe("needsProfileSchema", () => {
  it("refuses minors and unknown fields", () => {
    expect(needsProfileSchema.safeParse({ ...profile, age: 16 }).success).toBe(false);
    expect(needsProfileSchema.safeParse({ ...profile, weight: 80 }).success).toBe(false);
    expect(needsProfileSchema.parse({ ...profile, notes: undefined }).notes).toBe("");
  });
});
