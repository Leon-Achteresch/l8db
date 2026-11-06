import { describe, expect, test } from "bun:test";
import {
  APP_THEMES,
  activeThemeCssVars,
  appTheme,
  appThemeCssVars,
  DEFAULT_APP_THEME,
  normalizeAppTheme,
  themeSwatch,
} from "@/lib/app-themes";
import { resolveDbTheme } from "@/lib/db-theme";
import { DEFAULT_SETTINGS, useSettingsStore } from "@/lib/settings";

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

  test("chosen theme is independent of the database kind by default", () => {
    expect(DEFAULT_SETTINGS.dbThemes).toBe(false);
    for (const mode of ["light", "dark"] as const) {
      for (const theme of APP_THEMES) {
        const expected = appThemeCssVars(theme[mode], null);
        for (const [kind, provider] of [
          ["postgres", null],
          ["redis", null],
          ["mysql", "mariadb"],
          ["mongodb", null],
          ["oracle", null],
          [null, null],
        ] as const) {
          expect(activeThemeCssVars(theme.id, mode, false, kind, provider)).toEqual(expected);
        }
      }
    }
    expect(activeThemeCssVars("rose", "dark", true, "redis")["--db-hue"]).toBe(
      String(resolveDbTheme("redis").hue),
    );
  });

  test("stored settings drop the old database theme default", () => {
    const { migrate, merge } = useSettingsStore.persist.getOptions();
    const current = useSettingsStore.getState();
    const migrated = migrate?.({ dbThemes: true, lightTheme: "rose" }, 1) as Record<
      string,
      unknown
    >;
    expect(migrated.dbThemes).toBe(false);
    expect(migrated.lightTheme).toBe("rose");
    expect(merge?.(migrated, current).dbThemes).toBe(false);
    expect(merge?.({ dbThemes: true }, current).dbThemes).toBe(true);
    expect(merge?.({}, current).dbThemes).toBe(false);
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
