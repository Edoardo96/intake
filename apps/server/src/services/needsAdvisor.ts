import Anthropic, { APIError } from "@anthropic-ai/sdk";
import type { Message } from "@anthropic-ai/sdk/resources/messages";
import { limitTargets, type Language, type NeedsAiOpinion, type NeedsCheck, type NeedsProfile, type NeedsResult } from "@intake/shared";
import { z } from "zod";
import { LANGUAGE_NAMES, RecognitionError, failureOf, type MessagesClient } from "./mealRecognition.js";

/** What the AI gets: the form, the weight, the standard calculation and the data check. Nothing else is sent. */
export interface NeedsAdvisorInput {
  profile: NeedsProfile;
  weightKg: number;
  standard: NeedsResult;
  check: NeedsCheck;
}

const answerSchema = z.object({
  summary: z.string().trim().min(1).max(1200),
  kcal: z.number().positive().max(10_000),
  protein: z.number().nonnegative().max(1_000),
  carbs: z.number().nonnegative().max(1_500),
  fat: z.number().nonnegative().max(500),
  tips: z.array(z.string().trim().min(1).max(300)).max(5),
});

const ANSWER_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "kcal", "protein", "carbs", "fat", "tips"],
  properties: {
    summary: { type: "string", description: "Two to four short sentences: whether the standard calculation fits this person and why the proposal differs, if it does." },
    kcal: { type: "number", description: "Proposed daily calories." },
    protein: { type: "number", description: "Proposed daily protein, grams." },
    carbs: { type: "number", description: "Proposed daily carbohydrates, grams." },
    fat: { type: "number", description: "Proposed daily fat, grams." },
    tips: { type: "array", description: "Two to four short, practical tips for this goal (one sentence each).", items: { type: "string" } },
  },
} as const;

const system = (language: Language) =>
  [
    "You are a careful sports nutritionist reviewing daily calorie and macro targets for a healthy adult who tracks food in a personal diary.",
    "You get their profile, a standard calculation (Mifflin-St Jeor with activity) and, when available, a check against their real logged intake and weight trend.",
    "Trust the real data over the formula when the check has enough data; mention when the data are few.",
    "Propose daily calories and grams of protein, carbohydrates and fat that add up to the calories.",
    "Stay safe: never more than a 25% deficit or 20% surplus on maintenance, never below the basal rate, protein between 1.6 and 2.4 g/kg for active people, fat at least 0.6 g/kg.",
    "Do not diagnose or give medical advice; if the notes mention a medical condition, pregnancy or an eating disorder, keep the standard calculation and suggest asking a doctor or dietitian.",
    `Write the summary and the tips in ${LANGUAGE_NAMES[language]}, plainly, addressing the person directly.`,
  ].join(" ");

function userMessage({ profile, weightKg, standard, check }: NeedsAdvisorInput): string {
  const data = {
    profile: { ...profile, notes: undefined, weightKg },
    standardCalculation: standard,
    dataCheck: check,
  };
  const notes = profile.notes.trim();
  return `My data:\n${JSON.stringify(data, null, 2)}${notes ? `\n\nMy notes: ${notes}` : ""}`;
}

export interface NeedsAdvisorOptions {
  apiKey: string;
  /** Same model as the meal recognition (Impostazioni › Modello IA). */
  model: () => string;
  client?: MessagesClient;
  language?: () => Language;
  log?: { info(details: object, message: string): void; warn(details: object, message: string): void };
  now?: () => Date;
}

const MAX_TOKENS = 16_000;
const TIMEOUT_MS = 90_000;

/**
 * "Il parere dell'IA": asks Claude for an opinion on the needs, with a structured output, and keeps the proposal
 * inside the safety limits (`limitTargets`). Called only when the user asks; nothing is applied until they choose.
 */
export class NeedsAdvisor {
  private readonly client: MessagesClient;

  constructor(private readonly options: NeedsAdvisorOptions) {
    this.client = options.client ?? new Anthropic({ apiKey: options.apiKey, timeout: TIMEOUT_MS }).messages;
  }

  async advise(input: NeedsAdvisorInput): Promise<NeedsAiOpinion> {
    const model = this.options.model();
    let response: Message;
    try {
      response = await this.client.create({
        model,
        max_tokens: MAX_TOKENS,
        system: system(this.options.language?.() ?? "it"),
        output_config: { effort: "medium", format: { type: "json_schema", schema: ANSWER_JSON_SCHEMA } },
        messages: [{ role: "user", content: userMessage(input) }],
      });
    } catch (error) {
      const why = error instanceof APIError ? `Claude API error ${error.status ?? "-"} ${error.type ?? ""}: ${error.apiMessage ?? error.message}` : `Claude API not reachable: ${error instanceof Error ? error.message : String(error)}`;
      throw new RecognitionError(failureOf(error), why);
    }

    const usage = { model, stopReason: response.stop_reason, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens };
    this.options.log?.info(usage, "needs opinion");
    if (response.stop_reason === "refusal") throw new RecognitionError("refused", "Claude declined to give an opinion");
    if (response.stop_reason === "max_tokens") throw new RecognitionError("unreadable", "Claude API answer was cut at max_tokens");

    const text = response.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new RecognitionError("unreadable", "Claude API answer is not JSON");
    }
    const parsed = answerSchema.safeParse(json);
    if (!parsed.success) throw new RecognitionError("unreadable", "Claude API answer did not match the needs schema");
    const { summary, tips, ...proposal } = parsed.data;
    const { targets, limited } = limitTargets(proposal, input.profile, input.weightKg);
    return { at: (this.options.now?.() ?? new Date()).toISOString(), model, summary, targets, limited, tips: tips.slice(0, 4) };
  }
}
