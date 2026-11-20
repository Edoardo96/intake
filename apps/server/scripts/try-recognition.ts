// One-off check of the meal recognition against the real Claude API (not part of the app).
// Run with ANTHROPIC_API_KEY set: npx tsx apps/server/scripts/try-recognition.ts
// Prints, for each model and case, the stop reason, the token usage, the cost at list prices and the foods found.
import { MealRecognizer, RecognitionError } from "../src/services/mealRecognition.js";

const key = process.env.ANTHROPIC_API_KEY?.trim().replace(/^["']|["']$/g, "");
if (!key) {
  console.error("ANTHROPIC_API_KEY is missing");
  process.exit(1);
}

/** USD per million tokens (input, output), November 2026 list prices. */
const PRICES: Record<string, [number, number]> = { "claude-haiku-5-5": [0.1, 0.5], "claude-sonnet-5-5": [2, 10] };

// Public food photos from Wikimedia Commons, resized by Commons like the app does in the browser (longest edge 1568 px)
const PHOTOS = [
  { name: "gnocchi", file: "Gnocchi di patate con sugo di pomodoro e con gorgonzola.jpg", width: 1568 },
  { name: "amatriciana", file: "Pasta all'amatriciana.jpg", width: 1176 },
  { name: "piatto misto", file: "Combined plate, Milan.jpg", width: 1568 },
];
const TEXTS = ["80 g di pasta al pomodoro e un'insalata con un cucchiaio d'olio", "un cappuccino e un cornetto alla crema"];

async function photo(file: string, width: number) {
  const url = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=${width}`;
  const response = await fetch(url, { headers: { "user-agent": "intake-recognition-check/1.0 (https://github.com/mandalarigabriele/intake)" } });
  if (!response.ok) throw new Error(`photo ${file}: HTTP ${response.status}`);
  return { mediaType: "image/jpeg" as const, data: Buffer.from(await response.arrayBuffer()).toString("base64") };
}

const cases: Array<{ name: string; input: () => Promise<{ image?: { mediaType: "image/jpeg"; data: string }; text?: string }> }> = [
  ...PHOTOS.map((p) => ({ name: `foto ${p.name}`, input: async () => ({ image: await photo(p.file, p.width) }) })),
  ...TEXTS.map((text) => ({ name: `testo "${text.slice(0, 30)}"`, input: async () => ({ text }) })),
];

for (const model of Object.keys(PRICES)) {
  let usage: Record<string, unknown> = {};
  const recognizer = new MealRecognizer({
    apiKey: key,
    model: () => model,
    language: () => "it",
    log: { info: (details) => (usage = details as Record<string, unknown>), warn: (details, message) => console.log(`  ! ${message}`, details) },
  });
  console.log(`\n=== ${model}`);
  for (const test of cases) {
    usage = {};
    const started = Date.now();
    try {
      const input = await test.input();
      const meal = await recognizer.recognize(input);
      const [inPrice, outPrice] = PRICES[model]!;
      const cost = ((usage.inputTokens as number) * inPrice + (usage.outputTokens as number) * outPrice) / 1e6;
      console.log(
        `- ${test.name}: ${((Date.now() - started) / 1000).toFixed(1)} s, stop ${usage.stopReason}, input ${usage.inputTokens}, output ${usage.outputTokens} (thinking ${usage.thinkingTokens}), $${cost.toFixed(4)}`,
      );
      console.log(`    ${meal.description}: ${meal.items.map((i) => `${i.name} ${i.grams} g`).join(", ")}`);
    } catch (error) {
      const reason = error instanceof RecognitionError ? error.reason : "error";
      console.log(`- ${test.name}: FAILED (${reason}) ${error instanceof Error ? error.message : String(error)}`, usage);
    }
  }
}
