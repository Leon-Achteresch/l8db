import { describe, expect, test } from "bun:test";
import {
  APP_THEMES,
  appTheme,
  appThemeCssVars,
  DEFAULT_APP_THEME,
  normalizeAppTheme,
  themeSwatch,
} from "@/lib/app-themes";
import { resolveDbTheme } from "@/lib/db-theme";
import { useSettingsStore } from "@/lib/settings";

describe("app themes", () => {
  test("light and dark themes are chosen independently", () => {
    const store = useSettingsStore.getState();
    store.setLightTheme("grove");
    store.setDarkTheme("iris");
    expect(useSettingsStore.getState().lightTheme).toBe("grove");
    expect(useSettingsStore.getState().darkTheme).toBe("iris");
    store.setLightTheme("missing");
    expect(useSettingsStore.getState().lightTheme).toBe(DEFAULT_APP_THEME);
    store.setDarkTheme(DEFAULT_APP_THEME);
  });

  test("database themes override hue only while enabled", () => {
    const grove = appTheme("grove").dark;
    const db = resolveDbTheme("redis");
    expect(appThemeCssVars(grove, null)["--db-hue"]).toBe(String(grove.hue));
    expect(appThemeCssVars(grove, db)["--db-hue"]).toBe(String(db.hue));
    expect(appThemeCssVars(grove, db)["--db-tint"]).toBe(String(grove.tint));
  });

  test("unknown ids fall back to the default theme", () => {
    expect(normalizeAppTheme(42)).toBe(DEFAULT_APP_THEME);
    expect(appTheme("nope").id).toBe(DEFAULT_APP_THEME);
  });

  test("resolving theme variables stays cheap", () => {
    const samples: number[] = [];
    for (let run = 0; run < 25; run += 1) {
      const start = performance.now();
      for (let index = 0; index < 2000; index += 1) {
        const theme = APP_THEMES[index % APP_THEMES.length];
        appThemeCssVars(theme.dark, index % 2 ? resolveDbTheme("postgres") : null);
        themeSwatch(theme.light, "light");
      }
      samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    expect(samples[Math.floor(samples.length / 2)]).toBeLessThan(20);
    expect(samples[Math.floor(samples.length * 0.95)]).toBeLessThan(40);
  });
});
