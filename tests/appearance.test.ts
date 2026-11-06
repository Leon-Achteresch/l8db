import { describe, expect, test } from "bun:test";
import {
  LAYOUT_APPEARANCE_DEFAULTS,
  normalizeUiDensity,
  normalizeUiScale,
  TABLE_APPEARANCE_DEFAULTS,
  useSettingsStore,
} from "../src/lib/settings";

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

describe("onboarding appearance steps", () => {
  test("table and layout defaults are separate and together match the full reset", () => {
    const table = Object.keys(TABLE_APPEARANCE_DEFAULTS);
    const layout = Object.keys(LAYOUT_APPEARANCE_DEFAULTS);
    expect(table.filter((key) => layout.includes(key))).toEqual([]);
    useSettingsStore.setState({ uiScale: 120, tableStyle: "zebra" as never });
    useSettingsStore.setState(TABLE_APPEARANCE_DEFAULTS);
    expect(useSettingsStore.getState().uiScale).toBe(120);
    useSettingsStore.getState().resetAppearance();
    expect(useSettingsStore.getState()).toMatchObject({
      ...LAYOUT_APPEARANCE_DEFAULTS,
      ...TABLE_APPEARANCE_DEFAULTS,
    });
  });
});
