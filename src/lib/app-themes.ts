import type { DatabaseKind } from "@/lib/db";
import { type DbThemeTokens, resolveDbTheme } from "@/lib/db-theme";

export type ThemeMode = "light" | "dark";

export interface ThemeVariant {
  hue: number;
  chroma: number;
  tint: number;
  surfaceHue?: number;
  colors?: ThemeColors;
}

export interface AppTheme {
  id: string;
  name: string;
  light: ThemeVariant;
  dark: ThemeVariant;
  custom?: boolean;
}

export const THEME_COLOR_TOKENS = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "destructive",
  "border",
  "input",
  "ring",
  "sidebar",
  "sidebar-foreground",
  "sidebar-primary",
  "sidebar-primary-foreground",
  "sidebar-accent",
  "sidebar-accent-foreground",
  "sidebar-border",
  "sidebar-ring",
  "menu",
  "menu-highlight",
  "chart-1",
  "chart-2",
  "chart-3",
  "chart-4",
  "chart-5",
] as const;

export type ThemeColorToken = (typeof THEME_COLOR_TOKENS)[number];
export type ThemeColors = Partial<Record<ThemeColorToken, string>>;

export const MAX_CUSTOM_THEMES = 50;
const MAX_NAME = 60;
const ACCENT_TOKEN = /^(primary|ring|sidebar-primary|sidebar-ring|menu-highlight|chart-)/;
const COLOR_PATTERN = /^[#a-z0-9.,%()\s/+-]{1,80}$/i;

export const DEFAULT_APP_THEME = "l8db";

export const APP_THEMES: AppTheme[] = [
  {
    id: "l8db",
    name: "l8db",
    light: { hue: 248, chroma: 0.07, tint: 2.2, surfaceHue: 78 },
    dark: { hue: 248, chroma: 0.06, tint: 1.2 },
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

export function appTheme(id: string | undefined, custom: AppTheme[] = []): AppTheme {
  return THEMES_BY_ID.get(id ?? "") ?? custom.find((theme) => theme.id === id) ?? APP_THEMES[0];
}

export function normalizeAppTheme(id: unknown, custom: AppTheme[] = []): string {
  return typeof id === "string" && (THEMES_BY_ID.has(id) || custom.some((theme) => theme.id === id))
    ? id
    : DEFAULT_APP_THEME;
}

export function isThemeColor(value: unknown): value is string {
  if (typeof value !== "string" || !COLOR_PATTERN.test(value.trim())) return false;
  if (/url|var|expression/i.test(value)) return false;
  return typeof CSS === "undefined" || !CSS.supports || CSS.supports("color", value.trim());
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

export function normalizeThemeVariant(value: unknown, fallback: ThemeVariant): ThemeVariant {
  const raw = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const hue = clampNumber(raw.hue, 0, 360, fallback.hue);
  const variant: ThemeVariant = {
    hue,
    chroma: clampNumber(raw.chroma, 0, 0.4, fallback.chroma),
    tint: clampNumber(raw.tint, 0, 5, fallback.tint),
  };
  if (raw.surfaceHue !== undefined && raw.surfaceHue !== null)
    variant.surfaceHue = clampNumber(raw.surfaceHue, 0, 360, hue);
  const source = raw.colors && typeof raw.colors === "object" ? raw.colors : {};
  const colors: ThemeColors = {};
  for (const token of THEME_COLOR_TOKENS) {
    const color = (source as Record<string, unknown>)[token];
    if (isThemeColor(color)) colors[token] = color.trim();
  }
  if (Object.keys(colors).length) variant.colors = colors;
  return variant;
}

export function normalizeCustomTheme(value: unknown, id?: string): AppTheme | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const name = typeof raw.name === "string" ? raw.name.trim().slice(0, MAX_NAME) : "";
  const themeId = id ?? (typeof raw.id === "string" ? raw.id : "");
  if (!name || !/^custom-[\w-]{1,64}$/.test(themeId)) return null;
  const base = APP_THEMES[0];
  return {
    id: themeId,
    name,
    light: normalizeThemeVariant(raw.light, base.light),
    dark: normalizeThemeVariant(raw.dark, base.dark),
    custom: true,
  };
}

export function normalizeCustomThemes(value: unknown): AppTheme[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const themes: AppTheme[] = [];
  for (const entry of value.slice(0, MAX_CUSTOM_THEMES)) {
    const theme = normalizeCustomTheme(entry);
    if (theme && !seen.has(theme.id)) {
      seen.add(theme.id);
      themes.push(theme);
    }
  }
  return themes;
}

export function newCustomThemeId(): string {
  return `custom-${crypto.randomUUID()}`;
}

export function appThemeCssVars(
  variant: ThemeVariant,
  db: DbThemeTokens | null,
): Record<string, string> {
  return {
    "--db-hue": String(db ? db.hue : variant.hue),
    "--surface-hue": String(variant.surfaceHue ?? (db ? db.hue : variant.hue)),
    "--db-chroma": String(db ? Math.min(db.chroma, 0.045) : variant.chroma),
    "--db-glow": String(db ? Math.min(db.glow, 0.05) : Math.min(variant.chroma, 0.05)),
    "--db-tint": String(variant.tint),
    ...Object.fromEntries(
      Object.entries(variant.colors ?? {})
        .filter(([token]) => !db || !ACCENT_TOKEN.test(token))
        .map(([token, color]) => [`--${token}`, color]),
    ),
  };
}

export function activeThemeCssVars(
  themeId: string | undefined,
  mode: ThemeMode,
  dbThemes: boolean,
  kind?: DatabaseKind | null,
  providerId?: string | null,
  custom: AppTheme[] = [],
): Record<string, string> {
  return appThemeCssVars(
    appTheme(themeId, custom)[mode],
    dbThemes ? resolveDbTheme(kind, providerId) : null,
  );
}

export function themeSwatch(variant: ThemeVariant, mode: ThemeMode): string {
  const { hue, chroma, colors } = variant;
  const accent = Math.max(chroma * 1.6, 0.01);
  if (colors?.background || colors?.primary) {
    const surface =
      colors.background ??
      (mode === "light" ? `oklch(0.97 0.01 ${hue})` : `oklch(0.2 0.01 ${hue})`);
    const primary = colors.primary ?? `oklch(${mode === "light" ? 0.55 : 0.72} ${accent} ${hue})`;
    return `radial-gradient(circle at 70% 75%, ${primary} 0%, transparent 60%), radial-gradient(circle at 25% 25%, ${colors.card ?? surface} 0%, ${surface} 100%)`;
  }
  return mode === "light"
    ? `radial-gradient(circle at 70% 75%, oklch(0.72 ${accent} ${hue}) 0%, transparent 60%), radial-gradient(circle at 25% 25%, oklch(0.99 0.005 ${hue}) 0%, oklch(0.92 ${accent / 3} ${hue}) 100%)`
    : `radial-gradient(circle at 70% 75%, oklch(0.55 ${accent} ${hue}) 0%, transparent 60%), radial-gradient(circle at 25% 25%, oklch(0.32 ${accent / 2} ${hue}) 0%, oklch(0.16 ${accent / 4} ${hue}) 100%)`;
}
