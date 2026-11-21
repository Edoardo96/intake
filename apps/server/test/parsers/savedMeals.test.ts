import { describe, expect, it } from "vitest";
import { ParseError } from "../../src/parsers/common.js";
import { parseSavedMeals } from "../../src/parsers/savedMeals.js";
import { fixture } from "./fixtures.js";

describe("parseSavedMeals", () => {
  it("reads name, id, description, default type, figures per serving and the items", () => {
    const { value, warnings } = parseSavedMeals(fixture("saved-meals.txt"));
    expect(warnings).toEqual([]);
    expect(value).toEqual([
      { id: "0a9b8c7d-6e5f-4a3b-8c1d-0e9f8a7b6c5d", name: "Caffè e biscotti", description: "Caffè con 4 biscotti secchi", mealType: null, kcal: 190, protein: 3, carbs: 30, fat: 6, items: [] },
      {
        id: "6f1c2a9e-3b7d-4c21-9a0e-5d8b7c6a1f23",
        name: "Colazione solita",
        description: "Yogurt greco, fiocchi d'avena e banana",
        mealType: "breakfast",
        kcal: 342,
        protein: 21.3,
        carbs: 56,
        fat: 3.9,
        items: expect.any(Array),
      },
    ]);
    const items = value[1]!.items;
    expect(items.map((i) => [i.name, i.quantity, i.unit])).toEqual([
      ["Yogurt greco 0%", 150, "g"],
      ["Fiocchi d'avena", 40, "g"],
      ["Banana", 1, "pcs"],
    ]);
    expect(items[1]!.nutrients).toMatchObject({ kcal: 150, protein: 5, carbs: 24, fat: 3, fiber: 4, sugar: 0.5, addedSugar: 0 });
  });

  it("reads the empty answer as an empty list", () => {
    expect(parseSavedMeals(fixture("saved-meals-empty.txt"))).toEqual({ value: [], warnings: [] });
  });

  it("throws on an answer it does not recognize, instead of reporting no saved meals", () => {
    expect(() => parseSavedMeals("Something else")).toThrow(ParseError);
  });
});
