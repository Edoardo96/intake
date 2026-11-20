import { withFallback, type Language } from "@intake/shared";
import { en } from "./i18n/en";
import { it, type Strings } from "./i18n/it";
import { nl } from "./i18n/nl";

/**
 * User-facing texts. Every UI string lives in i18n/<language>.ts: Italian is the reference, the default and the
 * fallback; English and Dutch have the same shape. The language is one for the whole installation (Profilo › Lingua, stored on the server); this device
 * keeps a copy so the first frame is already in the right language. Changing it reloads the app.
 */

const STORAGE_KEY = "intake.language";
const BUNDLES: Record<Language, Strings> = { it, en, nl };

/** Number and date formatting locale of each language. */
export const LOCALES: Record<Language, string> = { it: "it-IT", en: "en-GB", nl: "nl-NL" };

/** Each language named in itself, for the picker in Profilo. */
export const LANGUAGE_NAMES: Record<Language, string> = { it: "Italiano", en: "English", nl: "Nederlands" };

const isLanguage = (value: unknown): value is Language => value === "it" || value === "en" || value === "nl";

function storedLanguage(): Language {
  try {
    const value = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (isLanguage(value)) return value;
  } catch {
    // Storage blocked: Italian
  }
  return "it";
}

// Italian is the fallback: a text missing from en.ts or nl.ts shows in Italian instead of breaking the screen
// (the type check still asks for every text, so a missing one is caught in CI).
export const language: Language = storedLanguage();
export const locale = LOCALES[language];
export const t: Strings = language === "it" ? it : withFallback(it, BUNDLES[language]);

if (typeof document !== "undefined") document.documentElement.lang = language;

/** Keeps the installation language on this device; returns true when it changed (the caller reloads). */
export function rememberLanguage(next: unknown): boolean {
  if (!isLanguage(next) || next === language) return false;
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, next);
  } catch {
    // Storage blocked: the language applies until the next load
  }
  return true;
}

/**
 * Reads the installation language once at startup; when another device changed it, this one follows and reloads.
 * The route is public, so the sign-in page is already in the right language.
 */
export function syncLanguage(): void {
  fetch("/api/language", { credentials: "same-origin" })
    .then((response) => (response.ok ? (response.json() as Promise<{ language?: unknown }>) : null))
    .then((body) => {
      if (body && rememberLanguage(body.language)) window.location.reload();
    })
    .catch(() => {
      // Offline or older server: keep the stored language
    });
}
