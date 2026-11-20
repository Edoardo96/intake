import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { openDatabase } from "../src/db/database.js";
import { LanguageStore } from "../src/db/languageStore.js";
import { pickInsight } from "../src/services/insight.js";
import { buildNotification } from "../src/services/reminders.js";
import { authOptions, signIn } from "./helpers.js";

describe("installation language", () => {
  it("defaults to Italian and is kept in the settings table", () => {
    const db = openDatabase(":memory:");
    expect(new LanguageStore(db).get()).toBe("it");
    new LanguageStore(db).set("nl");
    expect(new LanguageStore(db).get()).toBe("nl");
  });

  it("is readable without signing in and changeable only by the owner", async () => {
    const language = new LanguageStore(openDatabase(":memory:"));
    const app = await buildApp({ auth: authOptions(), language });
    expect((await app.inject({ method: "GET", url: "/api/language" })).json()).toEqual({ language: "it" });
    expect((await app.inject({ method: "PUT", url: "/api/language", payload: { language: "en" } })).statusCode).toBe(401);

    const { cookie } = await signIn(app);
    expect((await app.inject({ method: "PUT", url: "/api/language", headers: { cookie }, payload: { language: "de" } })).statusCode).toBe(400);
    const changed = await app.inject({ method: "PUT", url: "/api/language", headers: { cookie }, payload: { language: "en" } });
    expect(changed.json()).toEqual({ language: "en" });
    expect((await app.inject({ method: "GET", url: "/api/language" })).json()).toEqual({ language: "en" });
  });

  it("writes notifications in the chosen language", () => {
    const context = {
      now: "21:31",
      entries: [],
      totals: { kcal: 1950, protein: 120, carbs: 200, fat: 60, fiber: 20, waterMl: 1500 },
      goals: { kcal: 2200, protein: 150, carbs: null, fat: null, fiber: null, waterMl: 2500, steps: null },
    } as unknown as Parameters<typeof buildNotification>[1];
    const slot = { key: "k", kind: "summary" as const };
    expect(buildNotification(slot, context, "en")).toMatchObject({ title: "Today's summary", body: "1,950 kcal of 2,200 · protein 120 of 150 g" });
    expect(buildNotification(slot, context, "nl")).toMatchObject({ title: "Samenvatting van vandaag", body: "1.950 kcal van 2.200 · eiwit 120 van 150 g" });
    expect(buildNotification(slot, context)).toMatchObject({ title: "Riepilogo di oggi", body: "1.950 kcal su 2.200 · proteine 120 su 150 g" });
  });

  it("writes the daily insight in the chosen language", () => {
    const days = ["2026-11-14", "2026-11-15", "2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"].map((date, i) => ({
      date,
      mealCount: 3,
      kcal: i < 2 ? 2800 : 2000,
    }));
    const input = {
      today: "2026-11-20",
      patterns: { loggedDays: 7, breakfast: null },
      meals: [],
      summary: { days },
      proteinGoal: null,
    } as unknown as Parameters<typeof pickInsight>[0];
    expect(pickInsight(input, "en")).toEqual({
      text: "At the weekend you eat 2,800 kcal on average, against 2,000 kcal on weekdays.",
      window: "Last 7 days · 7 days logged",
    });
    expect(pickInsight(input, "nl")?.text).toBe("In het weekend eet je gemiddeld 2.800 kcal, tegen 2.000 kcal op doordeweekse dagen.");
  });
});
