import type { DbThemeTokens } from "@/lib/db-theme";

export type ThemeMode = "light" | "dark";

export interface ThemeVariant {
  hue: number;
  chroma: number;
  tint: number;
}

export interface AppTheme {
  id: string;
  name: string;
  light: ThemeVariant;
  dark: ThemeVariant;
}

export const DEFAULT_APP_THEME = "l8db";

export const APP_THEMES: AppTheme[] = [
  {
    id: "l8db",
    name: "l8db",
    light: { hue: 248, chroma: 0.045, tint: 1 },
    dark: { hue: 248, chroma: 0.045, tint: 1 },
  },
  {
    id: "graphite",
    name: "Graphite",
    light: { hue: 250, chroma: 0, tint: 0 },
    dark: { hue: 250, chroma: 0, tint: 0 },
  },
  {
    id: "rose",
    name: "Rose",
    light: { hue: 350, chroma: 0.11, tint: 2.6 },
    dark: { hue: 352, chroma: 0.1, tint: 2.4 },
  },
  {
    id: "grove",
    name: "Grove",
    light: { hue: 150, chroma: 0.09, tint: 2.4 },
    dark: { hue: 155, chroma: 0.09, tint: 2.2 },
  },
  {
    id: "ocean",
    name: "Ocean",
    light: { hue: 232, chroma: 0.11, tint: 2.6 },
    dark: { hue: 228, chroma: 0.1, tint: 2.6 },
  },
  {
    id: "ember",
    name: "Ember",
    light: { hue: 52, chroma: 0.11, tint: 2.6 },
    dark: { hue: 55, chroma: 0.1, tint: 2.4 },
  },
  {
    id: "iris",
    name: "Iris",
    light: { hue: 292, chroma: 0.12, tint: 2.6 },
    dark: { hue: 290, chroma: 0.12, tint: 2.6 },
  },
];

const THEMES_BY_ID = new Map(APP_THEMES.map((theme) => [theme.id, theme]));

export function appTheme(id: string | undefined): AppTheme {
  return THEMES_BY_ID.get(id ?? "") ?? APP_THEMES[0];
}

export function normalizeAppTheme(id: unknown): string {
  return typeof id === "string" && THEMES_BY_ID.has(id) ? id : DEFAULT_APP_THEME;
}

export function appThemeCssVars(
  variant: ThemeVariant,
  db: DbThemeTokens | null,
): Record<string, string> {
  return {
    "--db-hue": String(db ? db.hue : variant.hue),
    "--db-chroma": String(db ? Math.min(db.chroma, 0.045) : variant.chroma),
    "--db-glow": String(db ? Math.min(db.glow, 0.05) : Math.min(variant.chroma, 0.05)),
    "--db-tint": String(variant.tint),
  };
}

export function themeSwatch(variant: ThemeVariant, mode: ThemeMode): string {
  const { hue, chroma } = variant;
  const accent = Math.max(chroma * 1.6, 0.01);
  return mode === "light"
    ? `radial-gradient(circle at 70% 75%, oklch(0.72 ${accent} ${hue}) 0%, transparent 60%), radial-gradient(circle at 25% 25%, oklch(0.99 0.005 ${hue}) 0%, oklch(0.92 ${accent / 3} ${hue}) 100%)`
    : `radial-gradient(circle at 70% 75%, oklch(0.55 ${accent} ${hue}) 0%, transparent 60%), radial-gradient(circle at 25% 25%, oklch(0.32 ${accent / 2} ${hue}) 0%, oklch(0.16 ${accent / 4} ${hue}) 100%)`;
}
