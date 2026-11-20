import type { DayGoals, DayTotals, Language, PlannedEntry, ReminderSettings } from "@intake/shared";

/**
 * Reminder rules (pure). The scheduler asks which reminders are due from the plan times alone,
 * and only then reads Nutrition to drop the ones that no longer apply (meal already logged or
 * skipped, water on track). Notification text follows the installation language (Profilo › Lingua), Italian by default.
 */

export type ReminderKind = "meal" | "todo" | "water" | "summary";

export interface ReminderSlot {
  /** Unique per day and reminder, so a reminder is sent at most once. */
  key: string;
  kind: ReminderKind;
  planId?: number;
  index?: number;
}

export interface PlannedTime {
  planId: number;
  index: number;
  time: string;
}

export interface Notification {
  title: string;
  body: string;
  /** Path opened when the notification is tapped. */
  url: string;
  /** Same tag replaces an older notification on the device. */
  tag: string;
}

/** A reminder fires during this many minutes after its time (missed ticks, restarts). */
export const WINDOW_MINUTES = 10;
export const TODO_DELAY_MINUTES = 45;
export const WATER_TIMES = ["16:00", "20:00"] as const;
export const SUMMARY_TIME = "21:30";
/** Water is "behind" when it is this much below the share of the goal expected by now. */
const WATER_MARGIN_ML = 250;
/** The water goal is expected to be spread from 08:00 to 21:00. */
const WATER_DAY_START = 8 * 60;
const WATER_DAY_LENGTH = 13 * 60;

const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const inWindow = (now: string, at: number) => minutes(now) >= at && minutes(now) < at + WINDOW_MINUTES;

/** Reminders whose time window contains `now` (HH:MM), before checking whether they still apply. */
export function dueSlots(date: string, now: string, planned: PlannedTime[], settings: ReminderSettings): ReminderSlot[] {
  const slots: ReminderSlot[] = [];
  for (const meal of planned) {
    const id = `${date}:${meal.planId}:${meal.index}`;
    if (settings.meal && inWindow(now, minutes(meal.time))) slots.push({ key: `meal:${id}`, kind: "meal", planId: meal.planId, index: meal.index });
    if (settings.todo && inWindow(now, minutes(meal.time) + TODO_DELAY_MINUTES)) {
      slots.push({ key: `todo:${id}`, kind: "todo", planId: meal.planId, index: meal.index });
    }
  }
  if (settings.water) {
    for (const time of WATER_TIMES) if (inWindow(now, minutes(time))) slots.push({ key: `water:${date}:${time}`, kind: "water" });
  }
  if (settings.summary && inWindow(now, minutes(SUMMARY_TIME))) slots.push({ key: `summary:${date}`, kind: "summary" });
  return slots;
}

export interface ReminderContext {
  now: string;
  /** Planned meals that no logged meal covers (plannedEntries). */
  entries: PlannedEntry[];
  totals: DayTotals | null;
  goals: DayGoals | null;
}

const LOCALES: Record<Language, string> = { it: "it-IT", en: "en-GB", nl: "nl-NL" };

/** Notification texts, one set per UI language (the only user-facing text built on the server besides the daily insight). */
const TEXTS: Record<Language, {
  todoTitle: (title: string, time: string) => string;
  todoBody: string;
  waterTitle: (total: string, goal: string) => string;
  waterBody: (missing: string) => string;
  summaryTitle: string;
  of: string;
  protein: string;
}> = {
  it: {
    todoTitle: (title, time) => `${title} delle ${time}: l'hai registrato?`,
    todoBody: "Apri Intake: Mangiato come previsto, Altro… o Salta.",
    waterTitle: (total, goal) => `Acqua: ${total} su ${goal} L`,
    waterBody: (missing) => `Un bicchiere adesso? Ne mancano ${missing} L.`,
    summaryTitle: "Riepilogo di oggi",
    of: "su",
    protein: "proteine",
  },
  en: {
    todoTitle: (title, time) => `${title} at ${time}: did you log it?`,
    todoBody: "Open Intake: Eaten as planned, Other… or Skip.",
    waterTitle: (total, goal) => `Water: ${total} of ${goal} L`,
    waterBody: (missing) => `A glass now? ${missing} L to go.`,
    summaryTitle: "Today's summary",
    of: "of",
    protein: "protein",
  },
  nl: {
    todoTitle: (title, time) => `${title} van ${time}: heb je het geregistreerd?`,
    todoBody: "Open Intake: Gegeten volgens plan, Anders… of Overslaan.",
    waterTitle: (total, goal) => `Water: ${total} van ${goal} L`,
    waterBody: (missing) => `Nu een glas? Nog ${missing} L te gaan.`,
    summaryTitle: "Samenvatting van vandaag",
    of: "van",
    protein: "eiwit",
  },
};

/** The notification for a due slot, or null when it no longer applies. */
export function buildNotification(slot: ReminderSlot, context: ReminderContext, language: Language = "it"): Notification | null {
  const text = TEXTS[language];
  // "1.950" as in the web app (Italian and Dutch do not group four-digit numbers by default)
  const integer = new Intl.NumberFormat(LOCALES[language], { maximumFractionDigits: 0, useGrouping: "always" } as unknown as Intl.NumberFormatOptions);
  const liters = new Intl.NumberFormat(LOCALES[language], { maximumFractionDigits: 2 });
  const l = (ml: number) => liters.format(Math.round(ml / 10) / 100);
  switch (slot.kind) {
    case "meal":
    case "todo": {
      const entry = context.entries.find((e) => e.planId === slot.planId && e.index === slot.index);
      // Covered by a logged meal (no entry), skipped, or free: nothing to remind
      if (!entry || (entry.status !== "todo" && entry.status !== "planned")) return null;
      const kcal = entry.macros ? ` · ~${integer.format(entry.macros.kcal)} kcal` : "";
      if (slot.kind === "meal") {
        return { title: `${entry.title} · ${entry.time}`, body: `${entry.foods}${kcal}`, url: "/", tag: `meal-${entry.index}` };
      }
      return {
        title: text.todoTitle(entry.title, entry.time),
        body: text.todoBody,
        url: "/",
        tag: `meal-${entry.index}`,
      };
    }
    case "water": {
      const goal = context.goals?.waterMl;
      if (!goal || !context.totals) return null;
      const share = Math.min(Math.max((minutes(context.now) - WATER_DAY_START) / WATER_DAY_LENGTH, 0), 1);
      const total = context.totals.waterMl;
      if (total >= goal * share - WATER_MARGIN_ML) return null;
      return { title: text.waterTitle(l(total), l(goal)), body: text.waterBody(l(goal - total)), url: "/", tag: "water" };
    }
    case "summary": {
      const totals = context.totals;
      if (!totals || totals.kcal <= 0) return null;
      const goals = context.goals;
      const kcal = `${integer.format(totals.kcal)} kcal${goals?.kcal ? ` ${text.of} ${integer.format(goals.kcal)}` : ""}`;
      const protein = `${text.protein} ${integer.format(totals.protein)}${goals?.protein ? ` ${text.of} ${integer.format(goals.protein)}` : ""} g`;
      return { title: text.summaryTitle, body: `${kcal} · ${protein}`, url: "/andamento", tag: "summary" };
    }
  }
}
