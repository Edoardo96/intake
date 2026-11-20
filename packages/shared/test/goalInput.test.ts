import { describe, expect, it } from "vitest";
import { parseGoalInput, weightUnitOf } from "../src/goalInput.js";

describe("parseGoalInput", () => {
  it("reads a point or comma followed by three digits as thousands in calories and grams", () => {
    expect(parseGoalInput("kcal", "2.200")).toBe(2200);
    expect(parseGoalInput("kcal", "2,200")).toBe(2200);
    expect(parseGoalInput("kcal", "1.800")).toBe(1800);
    expect(parseGoalInput("kcal", " 2200 ")).toBe(2200);
    expect(parseGoalInput("protein", "150")).toBe(150);
  });

  it("refuses decimals in calories and grams instead of rounding them", () => {
    expect(parseGoalInput("kcal", "2.2")).toBeUndefined();
    expect(parseGoalInput("kcal", "2,20")).toBeUndefined();
    expect(parseGoalInput("fat", "70.5")).toBeUndefined();
  });

  it("refuses values outside the sanity range", () => {
    expect(parseGoalInput("kcal", "22000")).toBeUndefined();
    expect(parseGoalInput("kcal", "200")).toBeUndefined();
    expect(parseGoalInput("fiber", "300")).toBeUndefined();
    expect(parseGoalInput("waterL", "25")).toBeUndefined();
    expect(parseGoalInput("targetWeight", "15")).toBeUndefined();
    expect(parseGoalInput("kcal", "-5")).toBeUndefined();
    expect(parseGoalInput("kcal", "abc")).toBeUndefined();
  });

  it("reads decimals in water and target weight, and an empty field as null", () => {
    expect(parseGoalInput("waterL", "2,5")).toBe(2.5);
    expect(parseGoalInput("waterL", "2.5")).toBe(2.5);
    expect(parseGoalInput("targetWeight", "71,5")).toBe(71.5);
    expect(parseGoalInput("kcal", "  ")).toBeNull();
  });

  it("checks the target weight in the unit of the profile", () => {
    expect(parseGoalInput("targetWeight", "160", "lb")).toBe(160);
    expect(parseGoalInput("targetWeight", "500", "kg")).toBeUndefined();
    expect(parseGoalInput("targetWeight", "500", "lb")).toBe(500);
    expect(weightUnitOf("lbs")).toBe("lb");
    expect(weightUnitOf("kg")).toBe("kg");
    expect(weightUnitOf(null)).toBe("kg");
  });
});
