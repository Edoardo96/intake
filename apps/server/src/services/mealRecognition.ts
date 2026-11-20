import type { Language, RecognizedMeal } from "@intake/shared";
import { z } from "zod";

/** What the user sends: a photo of the plate, a free description, or both. */
export interface RecognitionInput {
  image?: { mediaType: "image/jpeg" | "image/png" | "image/webp"; data: string };
  text?: string;
}

export type RecognitionFailure = "auth" | "credit" | "busy" | "unreadable" | "failed";

/** The Claude API call did not give a usable answer. `reason` decides the HTTP status and the message in the app. */
export class RecognitionError extends Error {
  constructor(
    readonly reason: RecognitionFailure,
    message: string,
  ) {
    super(message);
    this.name = "RecognitionError";
  }
}

const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";
const TOOL = "record_meal";

const per100Schema = z.object({
  kcal: z.number().nonnegative(),
  protein: z.number().nonnegative(),
  carbs: z.number().nonnegative(),
  fat: z.number().nonnegative(),
  fiber: z.number().nonnegative().nullable().optional(),
  sugar: z.number().nonnegative().nullable().optional(),
  addedSugar: z.number().nonnegative().nullable().optional(),
});

const answerSchema = z.object({
  description: z.string().trim().min(1).max(300),
  items: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(120),
        grams: z.number().positive().max(3000),
        visible: z.boolean(),
        per100g: per100Schema,
      }),
    )
    .min(1)
    .max(20),
});

/** The first {...} block of a text answer, parsed; undefined when there is none. */
function jsonInText(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

/** JSON schema of the tool call: Claude answers only through it, so the output is always structured. */
const TOOL_SCHEMA = {
  type: "object",
  properties: {
    description: { type: "string", description: "Short description of the whole meal, in the language the system prompt asks for, e.g. \"Pasta al pomodoro con insalata mista\"." },
    items: {
      type: "array",
      description: "One entry per food, including oil, butter, sauces and dressings that are cooked in or poured on.",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "Name of the food as eaten, in the language the system prompt asks for, e.g. \"Pasta al pomodoro (cotta)\", \"Olio extravergine d'oliva\"." },
          grams: { type: "number", description: "Estimated weight eaten, in grams (for drinks, millilitres treated as grams)." },
          visible: { type: "boolean", description: "False when the food is not visible in the photo but almost certainly present (e.g. cooking oil), or when there is no photo." },
          per100g: {
            type: "object",
            description: "Nutrition per 100 g of this food as eaten (cooked weight for cooked foods).",
            properties: {
              kcal: { type: "number" },
              protein: { type: "number" },
              carbs: { type: "number" },
              fat: { type: "number" },
              fiber: { type: "number", description: "Dietary fiber; 0 for foods with none (meat, fish, eggs, dairy, oil, sugar)." },
              sugar: { type: "number", description: "Total sugars; 0 for foods with none (meat, fish, eggs, oil, plain pasta and rice)." },
              addedSugar: { type: "number", description: "Added sugars, part of sugar; 0 for whole fruit, vegetables, plain milk and yogurt, meat, fish, pasta, oil." },
            },
            required: ["kcal", "protein", "carbs", "fat", "fiber", "sugar", "addedSugar"],
          },
        },
        required: ["name", "grams", "visible", "per100g"],
      },
    },
  },
  required: ["description", "items"],
} as const;

const LANGUAGE_NAMES: Record<Language, string> = { it: "Italian", en: "English", nl: "Dutch" };

const system = (language: Language) => [
  "You estimate what a person ate from a photo of their plate and/or a short description, for a personal food diary.",
  "List every food separately with an estimated eaten weight in grams and nutrition per 100 g as eaten, using standard food composition values (e.g. CREA, USDA).",
  "Judge portion sizes from the plate, cutlery and food density; prefer typical home portions when unsure.",
  "Add cooking fats, dressings and sauces that are not visible but very likely present (mark them visible: false) with realistic amounts.",
  "If the description gives quantities or foods, they win over what the photo suggests.",
  `Write every name and the description in ${LANGUAGE_NAMES[language]}. Always answer by calling the record_meal tool, exactly once, with no other text.`,
].join(" ");

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export interface MealRecognizerOptions {
  apiKey: string;
  model: string;
  fetch?: FetchLike;
  timeoutMs?: number;
  /** Language of the food names and description (Profilo › Lingua); Italian when missing. */
  language?: () => Language;
}

/**
 * Recognizes the foods of a meal with the Claude API (vision): one tool call returns the foods, their
 * estimated grams and nutrition per 100 g. Nothing is stored; the user confirms or corrects before it is logged.
 */
export class MealRecognizer {
  private readonly fetch: FetchLike;

  constructor(private readonly options: MealRecognizerOptions) {
    this.fetch = options.fetch ?? (globalThis.fetch as unknown as FetchLike);
  }

  get model(): string {
    return this.options.model;
  }

  async recognize(input: RecognitionInput): Promise<RecognizedMeal> {
    const content: unknown[] = [];
    if (input.image) content.push({ type: "image", source: { type: "base64", media_type: input.image.mediaType, data: input.image.data } });
    const text = input.text?.trim();
    content.push({
      type: "text",
      text: input.image
        ? `Photo of my meal.${text ? ` Notes: ${text}` : ""}`
        : `I ate: ${text ?? ""}`,
    });

    const response = await this.fetch(API_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": this.options.apiKey, "anthropic-version": API_VERSION },
      body: JSON.stringify({
        model: this.options.model,
        max_tokens: 2000,
        system: system(this.options.language?.() ?? "it"),
        tools: [{ name: TOOL, description: "Record the foods of the meal with estimated grams and nutrition per 100 g.", input_schema: TOOL_SCHEMA }],
        // Newer models refuse a forced tool call (tool_choice "tool"/"any"); the system prompt asks for it instead
        tool_choice: { type: "auto" },
        messages: [{ role: "user", content }],
      }),
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 60_000),
    }).catch((error: unknown) => {
      throw new RecognitionError("failed", `Claude API not reachable: ${error instanceof Error ? error.message : String(error)}`);
    });

    if (!response.ok) {
      // The error body says why ({ error: { type, message } }); it never contains the key
      const detail = await response
        .json()
        .then((body) => (body as { error?: { type?: string; message?: string } }).error)
        .catch(() => undefined);
      const why = `Claude API error ${response.status}${detail?.type ? ` ${detail.type}` : ""}${detail?.message ? `: ${detail.message}` : ""}`;
      if (response.status === 401 || response.status === 403) throw new RecognitionError("auth", why);
      if (response.status === 429 || response.status === 529 || response.status === 503) throw new RecognitionError("busy", why);
      if (/credit balance|billing|purchase credits/i.test(detail?.message ?? "")) throw new RecognitionError("credit", why);
      throw new RecognitionError("failed", why);
    }

    const body = (await response.json()) as { content?: Array<{ type: string; name?: string; input?: unknown; text?: string }> };
    const call = body.content?.find((block) => block.type === "tool_use" && block.name === TOOL);
    // Without the tool call, accept the same object written as JSON in the text
    const parsed = answerSchema.safeParse(call ? call.input : jsonInText(body.content?.filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n") ?? ""));
    if (!parsed.success) throw new RecognitionError("unreadable", "Claude API answer did not match the meal schema");
    return {
      description: parsed.data.description,
      items: parsed.data.items.map((item) => ({
        name: item.name,
        grams: Math.round(item.grams),
        visible: item.visible,
        per100g: { ...item.per100g, fiber: item.per100g.fiber ?? null, sugar: item.per100g.sugar ?? null, addedSugar: item.per100g.addedSugar ?? null },
      })),
    };
  }
}
