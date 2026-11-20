import { describe, expect, it } from "vitest";
import { withFallback } from "../src/i18n.js";

describe("withFallback", () => {
  const italian = { today: "Oggi", nav: { add: "Aggiungi", plan: "Piano" }, days: ["L", "M"], count: (n: number) => `${n} pasti` };

  it("keeps the Italian text for anything the translation lacks", () => {
    const english = withFallback(italian, { today: "Today", nav: { add: "Add" } });
    expect(english.today).toBe("Today");
    expect(english.nav).toEqual({ add: "Add", plan: "Piano" });
    expect(english.days).toEqual(["L", "M"]);
    expect(english.count(2)).toBe("2 pasti");
  });

  it("takes arrays and functions whole, and leaves the Italian texts untouched", () => {
    const dutch = withFallback(italian, { days: ["M", "D", "W"], count: (n: number) => `${n} maaltijden` });
    expect(dutch.days).toEqual(["M", "D", "W"]);
    expect(dutch.count(3)).toBe("3 maaltijden");
    expect(italian.nav.add).toBe("Aggiungi");
  });
});
