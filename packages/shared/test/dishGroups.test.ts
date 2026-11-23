import { describe, expect, it } from "vitest";
import { alternativesFor, dishKey, dishMacros, linkDish, plannedFoodsOf, type Dish, type DishGroup } from "../src/index.js";

const dish = (name: string, aliases: string[] = []): Dish => ({
  name,
  aliases,
  foods: [{ name, quantity: 100, unit: "g", nutrients: { kcal: 300, protein: 20, carbs: 40, fat: 5, fiber: 3 } }],
  macros: null,
});

describe("dish groups", () => {
  it("compares dish names without case, accents or punctuation", () => {
    expect(dishKey("  Pasta con Tonno! ")).toBe("pasta con tonno");
    expect(dishKey("Caffè + brioche")).toBe("caffe brioche");
  });

  it("gives every other dish of the group as an alternative, in both directions", () => {
    const groups: DishGroup[] = [{ id: 1, dishes: [dish("Pasta con tonno"), dish("Pasta al salmone"), dish("Riso e pollo")] }];
    expect(alternativesFor(groups, "pasta con TONNO").map((a) => [a.dishIndex, a.dish.name])).toEqual([
      [1, "Pasta al salmone"],
      [2, "Riso e pollo"],
    ]);
    expect(alternativesFor(groups, "Pasta al salmone").map((a) => a.dish.name)).toEqual(["Pasta con tonno", "Riso e pollo"]);
    expect(alternativesFor(groups, "Frittata")).toEqual([]);
  });

  it("matches a dish by its other names", () => {
    const groups: DishGroup[] = [{ id: 1, dishes: [dish("Pasta con tonno", ["Pasta al tonno"]), dish("Pasta al salmone")] }];
    expect(alternativesFor(groups, "Pasta al tonno").map((a) => a.dish.name)).toEqual(["Pasta al salmone"]);
  });

  it("links into a new group, an existing group, or merges two groups", () => {
    const fresh = linkDish([], { dish: dish("A"), alternative: dish("B") });
    expect(fresh.keep).toBeNull();
    expect(fresh.dishes.map((d) => d.name)).toEqual(["A", "B"]);

    const groups: DishGroup[] = [
      { id: 1, dishes: [dish("A"), dish("B")] },
      { id: 2, dishes: [dish("C"), dish("D")] },
    ];
    const added = linkDish(groups, { dish: dish("b"), alternative: dish("E") });
    expect([added.keep?.id, added.drop, added.dishes.map((d) => d.name)]).toEqual([1, [], ["A", "B", "E"]]);

    const merged = linkDish(groups, { dish: dish("A"), alternative: dish("D") });
    expect([merged.keep?.id, merged.drop, merged.dishes.map((d) => d.name)]).toEqual([1, [2], ["A", "B", "C", "D"]]);
  });

  it("sums the foods' values when the dish has no totals", () => {
    expect(dishMacros({ foods: [...dish("A").foods, ...dish("B").foods], macros: null })).toEqual({ kcal: 600, protein: 40, carbs: 80, fat: 10, fiber: 6 });
    expect(dishMacros({ foods: [{ name: "Pane" }], macros: null })).toBeNull();
  });

  it("turns a favorite's items into planned foods", () => {
    const foods = plannedFoodsOf([
      { name: "Riso", quantity: 80, unit: "g", nutrients: { kcal: 290, protein: 6, carbs: 63, fat: 1, fiber: null, sugar: 0, addedSugar: 0 } },
    ]);
    expect(foods).toEqual([{ name: "Riso", quantity: 80, unit: "g", nutrients: { kcal: 290, protein: 6, carbs: 63, fat: 1, fiber: 0, sugar: 0, addedSugar: 0 } }]);
  });
});
