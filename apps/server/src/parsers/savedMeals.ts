import type { SavedMeal } from "@intake/shared";
import { leadingNumber, ParseError, type Parsed } from "./common.js";
import { parseItem } from "./meals.js";

const HEADER = /^- "(.+)" \[saved meal id: ([0-9a-f-]{36})\]\s*$/i;

/** Value after a "P ", "C ", "F " label in the "Per serving" line, e.g. "P 26.7 g". */
function figure(parts: string[], label: string): number | null {
  const part = parts.find((p) => p.startsWith(`${label} `));
  return part ? leadingNumber(part.slice(label.length + 1)) : null;
}

/**
 * get_saved_meals text: a count line, then one block per saved meal:
 * `- "Name" [saved meal id: <uuid>]` followed by indented "Description:", optional "Default meal type:",
 * "Per serving: 342 kcal · P 21.3 g · C 56 g · F 3.9 g · …" and an optional "Items:" list (indented by four spaces,
 * each item with its own figures, read like the items of a logged meal for the confirmation screen). "No saved meals yet." is an empty list; any other text without a
 * saved meal throws, so the add sheet says the favorites could not be read instead of "no favorites".
 */
export function parseSavedMeals(text: string): Parsed<SavedMeal[]> {
  const warnings: string[] = [];
  const meals: SavedMeal[] = [];
  let current: SavedMeal | null = null;
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const header = HEADER.exec(line);
    if (header) {
      current = { id: header[2]!.toLowerCase(), name: header[1]!, description: "", mealType: null, kcal: null, protein: null, carbs: null, fat: null, items: [] };
      meals.push(current);
      continue;
    }
    if (!current || !line.startsWith("  ")) continue;
    const body = line.trim();
    // "1. Yogurt greco 0% — 150 g — 87 kcal · P 15 g · …", as in a logged meal
    if (/^\d+\.\s/.test(body) && body.includes(" — ")) {
      const item = parseItem(body.replace(/^\d+\.\s+/, ""), `saved meal "${current.name}"`, warnings);
      if (item) current.items.push(item);
      continue;
    }
    if (body.startsWith("Description:")) current.description = body.slice("Description:".length).trim();
    else if (body.startsWith("Default meal type:")) current.mealType = body.slice("Default meal type:".length).trim() || null;
    else if (body.startsWith("Per serving:")) {
      const parts = body
        .slice("Per serving:".length)
        .split("·")
        .map((p) => p.trim());
      const kcal = parts.find((p) => p.endsWith("kcal"));
      current.kcal = kcal ? leadingNumber(kcal) : null;
      current.protein = figure(parts, "P");
      current.carbs = figure(parts, "C");
      current.fat = figure(parts, "F");
    }
  }
  if (meals.length === 0 && !/^No saved meals/i.test(text.trim())) throw new ParseError("unrecognized get_saved_meals response", text);
  return { value: meals, warnings };
}
