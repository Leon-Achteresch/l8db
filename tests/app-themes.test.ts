import { describe, expect, test } from "bun:test";
import {
  APP_THEMES,
  activeThemeCssVars,
  appTheme,
  appThemeCssVars,
  DEFAULT_APP_THEME,
  MAX_CUSTOM_THEMES,
  normalizeAppTheme,
  normalizeCustomThemes,
  THEME_COLOR_TOKENS,
  themeSwatch,
} from "@/lib/app-themes";
import { resolveDbTheme } from "@/lib/db-theme";
import { DEFAULT_SETTINGS, useSettingsStore } from "@/lib/settings";
import {
  MAX_THEME_FILE,
  parseThemeFile,
  serializeThemeFile,
  themeAiPrompt,
} from "@/lib/theme-file";

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
    expect(appThemeCssVars(grove, db)["--surface-hue"]).toBe(String(db.hue));
    const paper = appTheme(DEFAULT_APP_THEME).light;
    expect(appThemeCssVars(paper, db)["--surface-hue"]).toBe(String(paper.surfaceHue));
    expect(appThemeCssVars(paper, db)["--db-hue"]).toBe(String(db.hue));
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

  test("custom themes are saved, selected, exported and deleted", () => {
    const store = useSettingsStore.getState();
    const theme = parseThemeFile(
      JSON.stringify({
        format: "l8db-theme",
        version: 1,
        name: "Nord",
        light: { hue: 220, chroma: 0.05, tint: 1.5, colors: { background: "#eceff4" } },
        dark: {
          hue: 210,
          chroma: 0.06,
          tint: 2,
          colors: { background: "oklch(0.25 0.02 250)", primary: "#88c0d0" },
        },
      }),
    );
    store.saveCustomTheme(theme);
    store.setDarkTheme(theme.id);
    expect(useSettingsStore.getState().darkTheme).toBe(theme.id);
    const vars = activeThemeCssVars(
      theme.id,
      "dark",
      true,
      "redis",
      null,
      useSettingsStore.getState().customThemes,
    );
    expect(vars["--background"]).toBe("oklch(0.25 0.02 250)");
    expect(vars["--primary"]).toBeUndefined();
    expect(
      activeThemeCssVars(
        theme.id,
        "dark",
        false,
        null,
        null,
        useSettingsStore.getState().customThemes,
      )["--primary"],
    ).toBe("#88c0d0");
    expect(themeSwatch(theme.dark, "dark")).toContain("#88c0d0");
    const copy = parseThemeFile(serializeThemeFile(theme));
    expect(copy.id).not.toBe(theme.id);
    expect(copy.dark).toEqual(theme.dark);
    expect(copy.name).toBe("Nord");
    const { merge } = useSettingsStore.persist.getOptions();
    const merged = merge?.(
      { customThemes: [theme], darkTheme: theme.id },
      useSettingsStore.getState(),
    );
    expect(merged?.darkTheme).toBe(theme.id);
    store.deleteCustomTheme(theme.id);
    expect(useSettingsStore.getState().customThemes).toHaveLength(0);
    expect(useSettingsStore.getState().darkTheme).toBe(DEFAULT_APP_THEME);
  });

  test("imported themes accept AI prose and reject unsafe or broken values", () => {
    const theme = parseThemeFile(
      `Hier ist dein Theme:\n\`\`\`json\n${JSON.stringify({
        name: "x".repeat(200),
        light: {
          hue: 999,
          chroma: -1,
          tint: "2",
          colors: {
            background: "url(https://example.com/a.png)",
            foreground: "red; --x: 1",
            primary: "var(--secret)",
            card: "#ffffff",
            unknown: "#000000",
          },
        },
        dark: { hue: 10, chroma: 0.1, tint: 1 },
      })}\n\`\`\``,
    );
    expect(theme.name).toHaveLength(60);
    expect(theme.light.hue).toBe(360);
    expect(theme.light.chroma).toBe(0);
    expect(theme.light.tint).toBe(2);
    expect(theme.light.colors).toEqual({ card: "#ffffff" });
    expect(() => parseThemeFile("kein json")).toThrow();
    expect(() =>
      parseThemeFile(JSON.stringify({ format: "l8db-chart", light: {}, dark: {} })),
    ).toThrow();
    expect(() => parseThemeFile(" ".repeat(MAX_THEME_FILE + 1))).toThrow();
    expect(themeAiPrompt("Nord")).toContain("sidebar-primary-foreground");
  });

  test("custom themes stay bounded and cheap to resolve", () => {
    const colors = Object.fromEntries(THEME_COLOR_TOKENS.map((token) => [token, "#123456"]));
    const stored = Array.from({ length: 500 }, (_, index) => ({
      id: `custom-${index}`,
      name: `Theme ${index}`,
      light: { hue: index % 360, chroma: 0.1, tint: 2, colors },
      dark: { hue: index % 360, chroma: 0.1, tint: 2, colors },
    }));
    const parseSamples: number[] = [];
    let themes = normalizeCustomThemes(stored);
    for (let run = 0; run < 15; run += 1) {
      const start = performance.now();
      themes = normalizeCustomThemes(stored);
      parseSamples.push(performance.now() - start);
    }
    expect(themes).toHaveLength(MAX_CUSTOM_THEMES);
    const samples: number[] = [];
    for (let run = 0; run < 25; run += 1) {
      const start = performance.now();
      for (let index = 0; index < 2000; index += 1) {
        const theme = themes[index % themes.length];
        activeThemeCssVars(theme.id, index % 2 ? "dark" : "light", false, null, null, themes);
      }
      samples.push(performance.now() - start);
    }
    const p = (values: number[], q: number) =>
      [...values].sort((a, b) => a - b)[Math.floor(values.length * q)];
    expect(p(parseSamples, 0.5)).toBeLessThan(15);
    expect(p(parseSamples, 0.95)).toBeLessThan(30);
    expect(p(samples, 0.5)).toBeLessThan(30);
    expect(p(samples, 0.95)).toBeLessThan(60);
    console.log(
      `custom themes: normalize 500→50 p50 ${p(parseSamples, 0.5).toFixed(2)}ms p95 ${p(parseSamples, 0.95).toFixed(2)}ms; 2000 resolves p50 ${p(samples, 0.5).toFixed(2)}ms p95 ${p(samples, 0.95).toFixed(2)}ms`,
    );
  });
});
