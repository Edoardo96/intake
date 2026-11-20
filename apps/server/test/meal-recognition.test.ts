import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { MealPhotoStore } from "../src/db/mealPhotoStore.js";
import { buildApp } from "../src/app.js";
import type { MealRoutesOptions } from "../src/routes/meals.js";
import { MealRecognizer, RecognitionError } from "../src/services/mealRecognition.js";
import { authOptions, signIn } from "./helpers.js";

const answer = {
  description: "Pasta al pomodoro con insalata",
  items: [
    { name: "Pasta al pomodoro (cotta)", grams: 251.4, visible: true, per100g: { kcal: 130, protein: 4.5, carbs: 25, fat: 1.5, fiber: 1.8, sugar: 2.1, addedSugar: 0 } },
    { name: "Olio extravergine d'oliva", grams: 10, visible: false, per100g: { kcal: 884, protein: 0, carbs: 0, fat: 100 } },
  ],
};

function fakeFetch(status: number, body: unknown) {
  return vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body }));
}

describe("MealRecognizer", () => {
  it("sends the photo with the record_meal tool (tool_choice auto, not forced) and returns the foods", async () => {
    const fetch = fakeFetch(200, { content: [{ type: "text", text: "ok" }, { type: "tool_use", name: "record_meal", input: answer }] });
    const recognizer = new MealRecognizer({ apiKey: "sk-test", model: "claude-sonnet-5-5", fetch });
    const meal = await recognizer.recognize({ image: { mediaType: "image/jpeg", data: "aGVsbG8gd29ybGQgaGVsbG8=" }, text: "senza parmigiano" });

    expect(meal.description).toBe("Pasta al pomodoro con insalata");
    expect(meal.items[0]).toEqual({ name: "Pasta al pomodoro (cotta)", grams: 251, visible: true, per100g: answer.items[0]!.per100g });
    expect(meal.items[1]!.per100g).toEqual({ kcal: 884, protein: 0, carbs: 0, fat: 100, fiber: null, sugar: null, addedSugar: null });

    const [url, init] = fetch.mock.calls[0] as unknown as [string, { headers: Record<string, string>; body: string }];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init.headers["x-api-key"]).toBe("sk-test");
    const sent = JSON.parse(init.body);
    expect(sent.model).toBe("claude-sonnet-5-5");
    expect(sent.tool_choice).toEqual({ type: "auto" });
    expect(sent.tools[0].input_schema.properties.items.items.properties.per100g.required).toEqual(["kcal", "protein", "carbs", "fat", "fiber", "sugar", "addedSugar"]);
    expect(sent.tools[0].name).toBe("record_meal");
    expect(sent.messages[0].content[0]).toEqual({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: "aGVsbG8gd29ybGQgaGVsbG8=" } });
    expect(sent.messages[0].content[1].text).toContain("senza parmigiano");
  });

  it("accepts the same answer written as JSON in a text block", async () => {
    const fetch = fakeFetch(200, { content: [{ type: "text", text: `Ecco il pasto:\n${JSON.stringify(answer)}` }] });
    const meal = await new MealRecognizer({ apiKey: "k", model: "m", fetch }).recognize({ text: "pasta" });
    expect(meal.items.map((i) => i.name)).toEqual(["Pasta al pomodoro (cotta)", "Olio extravergine d'oliva"]);
  });

  it("turns API failures and malformed answers into RecognitionError", async () => {
    const run = (status: number, body: unknown = {}) =>
      new MealRecognizer({ apiKey: "k", model: "m", fetch: fakeFetch(status, body) }).recognize({ text: "una mela" }).catch((e: RecognitionError) => e.reason);
    expect(await run(401)).toBe("auth");
    expect(await run(529)).toBe("busy");
    expect(await run(500)).toBe("failed");
    expect(await run(400, { type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API." } })).toBe("credit");
    const error = await new MealRecognizer({ apiKey: "k", model: "m", fetch: fakeFetch(404, { error: { type: "not_found_error", message: "model: m" } }) })
      .recognize({ text: "una mela" })
      .catch((e: RecognitionError) => e);
    expect((error as RecognitionError).message).toBe("Claude API error 404 not_found_error: model: m");
    expect(await run(200, { content: [{ type: "tool_use", name: "record_meal", input: { description: "x", items: [] } }] })).toBe("unreadable");
  });
});

describe("recognize and create routes", () => {
  const api = {
    clock: async () => ({ timezone: "Europe/Rome", localDate: "2026-11-19", localTime: "13:00:00", utc: "" }),
    mealsByDate: async () => ({ timezone: null, meals: [] }),
    mealsByRange: async () => ({ timezone: null, meals: [] }),
    logMeal: vi.fn(async () => ({ id: "new-meal-id" })),
    updateMeal: async () => {},
    deleteMeal: async () => {},
    saveMeal: vi.fn(async () => {}),
    savedMeals: async () => [],
    logSavedMeal: async () => ({ id: null }),
  } satisfies MealRoutesOptions["api"];

  async function signedIn(recognizer?: MealRoutesOptions["recognizer"], mealPhotos?: MealPhotoStore) {
    const app = await buildApp({ auth: authOptions(), mealsApi: api, recognizer, mealPhotos });
    const { cookie } = await signIn(app);
    return { app, headers: { cookie } };
  }

  it("answers 503 without an API key and 400 without photo or text", async () => {
    const off = await signedIn();
    expect((await off.app.inject({ method: "POST", url: "/api/meals/recognize", headers: off.headers, payload: { text: "una mela" } })).json()).toEqual({ error: "recognition_not_configured" });
    const on = await signedIn({ recognize: async () => answer as never });
    expect((await on.app.inject({ method: "POST", url: "/api/meals/recognize", headers: on.headers, payload: {} })).statusCode).toBe(400);
  });

  it("returns the recognized meal and maps a busy API to 503", async () => {
    const recognize = vi.fn(async () => answer as never);
    const { app, headers } = await signedIn({ recognize });
    const ok = await app.inject({ method: "POST", url: "/api/meals/recognize", headers, payload: { text: "pasta al pomodoro" } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().description).toBe("Pasta al pomodoro con insalata");
    expect(recognize).toHaveBeenCalledWith({ text: "pasta al pomodoro" });

    recognize.mockRejectedValueOnce(new RecognitionError("busy", "busy"));
    const busy = await app.inject({ method: "POST", url: "/api/meals/recognize", headers, payload: { text: "pasta" } });
    expect(busy.statusCode).toBe(503);
    expect(busy.json()).toEqual({ error: "recognition_busy" });
  });

  it("logs a confirmed meal with its items and an idempotency key", async () => {
    const { app, headers } = await signedIn();
    const response = await app.inject({
      method: "POST",
      url: "/api/meals",
      headers,
      payload: {
        date: "2026-11-19",
        time: "13:05",
        type: "lunch",
        description: "Pasta al pomodoro con insalata",
        idempotencyKey: "photo-12345678",
        items: [
          {
            name: "Pasta al pomodoro (cotta)",
            quantity: 250,
            unit: "g",
            nutrients: { kcal: 325, protein: 11.25, carbs: 62.5, fat: 3.75, saturatedFat: null, transFat: null, fiber: 4.5, sugar: 5.25, addedSugar: null, alcohol: null, caffeineMg: null, sodiumMg: null },
          },
        ],
      },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ mealId: "new-meal-id", photoSaved: false, favoriteSaved: false });
    expect(api.logMeal).toHaveBeenCalledWith(
      expect.objectContaining({ description: "Pasta al pomodoro con insalata", meal_type: "lunch", logged_at: "2026-11-19T13:05", idempotency_key: "photo-12345678" }),
    );
    // fiber on one item only: left out on all of them, as Nutrition requires
    const mixed = { kcal: 10, protein: 1, carbs: 1, fat: 1, saturatedFat: null, transFat: null, fiber: null, sugar: null, addedSugar: null, alcohol: null, caffeineMg: null, sodiumMg: null };
    await app.inject({
      method: "POST",
      url: "/api/meals",
      headers,
      payload: {
        date: "2026-11-19",
        time: "13:05",
        type: "lunch",
        description: "Pasta e olio",
        idempotencyKey: "photo-mixed-1234",
        items: [
          { name: "Pasta", quantity: 250, unit: "g", nutrients: { ...mixed, fiber: 4.5, sugar: 5, addedSugar: 0 } },
          { name: "Olio", quantity: 10, unit: "g", nutrients: mixed },
        ],
      },
    });
    const items = (api.logMeal.mock.calls.at(-1) as unknown as [{ items: Record<string, unknown>[] }])[0].items;
    expect(items.every((item) => !("fiber_g" in item) && !("sugar_g" in item) && !("added_sugar_g" in item))).toBe(true);
    expect(items[0]).toMatchObject({ name: "Pasta", amount: 250, unit: "g", calories: 10 });

    // also saved as favorite under the new meal's id
    api.logMeal.mockResolvedValueOnce({ id: "fav-meal-id" });
    const withFavorite = await app.inject({
      method: "POST",
      url: "/api/meals",
      headers,
      payload: { date: "2026-11-19", time: "08:00", type: "breakfast", description: "Yogurt", idempotencyKey: "photo-fav-12345", favoriteName: "Colazione solita", totals: { kcal: 200, protein: 15, carbs: 20, fat: 5 } },
    });
    expect(withFavorite.json()).toEqual({ mealId: "fav-meal-id", photoSaved: false, favoriteSaved: true });
    expect(api.saveMeal).toHaveBeenCalledWith("Colazione solita", "fav-meal-id");

    const missingKey = await app.inject({ method: "POST", url: "/api/meals", headers, payload: { date: "2026-11-19", time: "13:05", type: "lunch", description: "x", totals: { kcal: 1, protein: 0, carbs: 0, fat: 0 } } });
    expect(missingKey.statusCode).toBe(400);
  });

  it("keeps the photo of a meal logged from a photo, serves it and deletes it with the meal", async () => {
    const id = "3f2b9c1e-1111-4222-8333-944455556666";
    api.logMeal.mockResolvedValueOnce({ id });
    const photos = new MealPhotoStore(join(mkdtempSync(join(tmpdir(), "intake-photos-")), "meal-photos"));
    const { app, headers } = await signedIn(undefined, photos);
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
    const meal = { date: "2026-11-19", time: "13:05", type: "lunch", description: "Pasta", idempotencyKey: "photo-87654321", totals: { kcal: 300, protein: 10, carbs: 50, fat: 5 } };

    const logged = await app.inject({ method: "POST", url: "/api/meals", headers, payload: { ...meal, photo: { mediaType: "image/jpeg", data: jpeg.toString("base64") } } });
    expect(logged.json()).toEqual({ mealId: id, photoSaved: true, favoriteSaved: false });
    expect((await app.inject({ method: "GET", url: "/api/meals/photos", headers })).json()).toEqual({ mealIds: [id] });
    const photo = await app.inject({ method: "GET", url: `/api/meals/${id}/photo`, headers });
    expect(photo.headers["content-type"]).toBe("image/jpeg");
    expect(photo.rawPayload.equals(jpeg)).toBe(true);
    expect((await app.inject({ method: "GET", url: `/api/meals/${id}/photo` })).statusCode).toBe(401);

    // Not a JPEG: refused before anything is logged
    const calls = api.logMeal.mock.calls.length;
    const bad = await app.inject({ method: "POST", url: "/api/meals", headers, payload: { ...meal, photo: { mediaType: "image/jpeg", data: Buffer.from("not a jpeg at all").toString("base64") } } });
    expect(bad.statusCode).toBe(400);
    expect(api.logMeal.mock.calls.length).toBe(calls);

    expect((await app.inject({ method: "DELETE", url: `/api/meals/${id}`, headers })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `/api/meals/${id}/photo`, headers })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/api/meals/..%2F..%2Fintake.db/photo", headers })).statusCode).toBe(404);
  });
});
