import { describe, expect, test } from "bun:test";
import { normalizeUiDensity, normalizeUiScale } from "../src/lib/settings";

describe("stored appearance settings", () => {
  test("old or invalid scale settings preserve a readable default", () => {
    for (const value of [undefined, null, "150", Number.NaN, Infinity, {}, []]) {
      expect(normalizeUiScale(value)).toBe(100);
    }
  });
  test("scale is bounded and rounded to keyboard increments", () => {
    expect(normalizeUiScale(-20)).toBe(80);
    expect(normalizeUiScale(400)).toBe(150);
    expect(normalizeUiScale(107)).toBe(105);
    expect(normalizeUiScale(108)).toBe(110);
  });
  test("density accepts supported values and recovers from corrupt storage", () => {
    expect(normalizeUiDensity("compact")).toBe("compact");
    expect(normalizeUiDensity("spacious")).toBe("spacious");
    for (const value of ["normal", undefined, null, "dense", 1]) {
      expect(normalizeUiDensity(value)).toBe("normal");
    }
  });
});
