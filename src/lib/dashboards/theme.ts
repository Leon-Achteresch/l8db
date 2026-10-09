import type { DashboardTheme, ThemeCard, ThemeDensity, ThemeFont } from "./model";

export const MAX_IMAGE_BYTES = 512 * 1024;
export const MAX_PALETTE = 8;

const COLOR = /^(?:#[0-9a-f]{3,8}|(?:rgba?|hsla?|oklch|oklab)\([0-9a-z.,%/ +-]*\))$/i;
const IMAGE = /^data:image\/(?:png|jpeg|gif|webp|svg\+xml)(?:;[a-z0-9=._+-]+)*,/i;
const HTTPS = /^https:\/\/[^\s"'<>]+$/i;

export const FONT_LABEL: Record<ThemeFont, string> = {
  system: "System",
  inter: "Modern",
  serif: "Serif",
  mono: "Monospace",
  rounded: "Rund",
  condensed: "Schmal",
};

const FONT_STACK: Record<ThemeFont, string> = {
  system: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  inter: 'Inter, "Segoe UI Variable", "Helvetica Neue", Arial, sans-serif',
  serif: 'Charter, "Bitstream Charter", Georgia, Cambria, "Times New Roman", serif',
  mono: 'ui-monospace, "SF Mono", "Cascadia Code", Menlo, Consolas, monospace',
  rounded: 'ui-rounded, "SF Pro Rounded", "Nunito", "Varela Round", "Segoe UI", sans-serif',
  condensed:
    '"Roboto Condensed", "Arial Narrow", "Helvetica Neue Condensed", sans-serif-condensed, sans-serif',
};

export const CARD_LABEL: Record<ThemeCard, string> = {
  outlined: "Rahmen",
  elevated: "Schatten",
  flat: "Flach",
  glass: "Glas",
};

export const DENSITY_LABEL: Record<ThemeDensity, string> = {
  compact: "Kompakt",
  normal: "Normal",
  spacious: "Großzügig",
};

const DENSITY_PADDING: Record<ThemeDensity, string> = {
  compact: "10px",
  normal: "16px",
  spacious: "24px",
};

export function isThemeColor(value: unknown): value is string {
  return typeof value === "string" && value.length <= 64 && COLOR.test(value.trim());
}

export function isImageDataUrl(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 64 &&
    IMAGE.test(value)
  );
}

export function isHttpsUrl(value: unknown): value is string {
  return typeof value === "string" && value.length <= 2000 && HTTPS.test(value);
}

function text(value: unknown, max: number, label: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new Error(`${label} muss ein Text sein.`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new Error(`${label} darf höchstens ${max} Zeichen haben.`);
  return trimmed || undefined;
}

function oneOf<T extends string>(
  value: unknown,
  allowed: Record<T, string>,
  label: string,
): T | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string" && value in allowed) return value as T;
  throw new Error(`${label}: erlaubt sind ${Object.keys(allowed).join(", ")}.`);
}

function color(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (!isThemeColor(value))
    throw new Error(`${label} muss eine Farbe sein (#rrggbb, rgb(), hsl(), oklch()).`);
  return value.trim();
}

const COLOR_KEYS = ["primary", "background", "surface", "text", "muted", "border"] as const;

export function sanitizeTheme(value: unknown): DashboardTheme | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value))
    throw new Error("Das Dashboard-Theme muss ein Objekt sein.");
  const input = value as Record<string, unknown>;
  const theme: DashboardTheme = {
    brand: text(input.brand, 80, "Markenname"),
    tagline: text(input.tagline, 160, "Untertitel"),
    font: oneOf(input.font, FONT_LABEL, "Schrift"),
    card: oneOf(input.card, CARD_LABEL, "Kartenstil"),
    density: oneOf(input.density, DENSITY_LABEL, "Abstände"),
    nav: oneOf(input.nav, { tabs: "", sidebar: "" }, "Navigation"),
  };
  for (const key of COLOR_KEYS) theme[key] = color(input[key], `Farbe ${key}`);
  if (input.logo !== undefined && input.logo !== null && input.logo !== "") {
    if (!isImageDataUrl(input.logo))
      throw new Error("Das Logo muss ein Bild als data:image-URL sein (höchstens 512 KiB).");
    theme.logo = input.logo;
  }
  if (input.palette !== undefined && input.palette !== null) {
    if (!Array.isArray(input.palette) || input.palette.length > MAX_PALETTE)
      throw new Error("Die Palette braucht 1 bis 8 Farben.");
    const palette = input.palette.map((entry, index) => color(entry, `Palette ${index + 1}`));
    const valid = palette.filter((entry): entry is string => Boolean(entry));
    if (valid.length) theme.palette = valid;
  }
  if (input.radius !== undefined && input.radius !== null) {
    const radius = Number(input.radius);
    if (!Number.isInteger(radius) || radius < 0 || radius > 32)
      throw new Error("Der Eckenradius muss eine ganze Zahl von 0 bis 32 sein.");
    theme.radius = radius;
  }
  if (input.header !== undefined && input.header !== null) {
    if (typeof input.header !== "boolean") throw new Error("header muss true oder false sein.");
    theme.header = input.header;
  }
  const clean = Object.fromEntries(
    Object.entries(theme).filter(([, entry]) => entry !== undefined),
  ) as DashboardTheme;
  return Object.keys(clean).length ? clean : null;
}

export function themeShowsHeader(theme: DashboardTheme | null | undefined): boolean {
  if (!theme) return false;
  return theme.header ?? Boolean(theme.brand || theme.logo || theme.tagline);
}

export function themeCss(theme: DashboardTheme | null | undefined): string {
  if (!theme) return "";
  const vars: string[] = [];
  const set = (name: string, value: string | undefined, important = false) => {
    if (value) vars.push(`  ${name}: ${value}${important ? " !important" : ""};`);
  };
  const valid = (value: unknown) => (isThemeColor(value) ? value.trim() : undefined);
  theme = {
    ...theme,
    background: valid(theme.background),
    text: valid(theme.text),
    surface: valid(theme.surface),
    border: valid(theme.border),
    muted: valid(theme.muted),
    primary: valid(theme.primary),
    palette: theme.palette?.filter(isThemeColor),
    font: theme.font && theme.font in FONT_STACK ? theme.font : undefined,
    density: theme.density && theme.density in DENSITY_PADDING ? theme.density : undefined,
    radius:
      Number.isInteger(theme.radius) && (theme.radius ?? -1) >= 0 && (theme.radius ?? 99) <= 32
        ? theme.radius
        : undefined,
  };
  set("--background", theme.background);
  set("--foreground", theme.text);
  set("--card", theme.surface);
  set("--card-foreground", theme.text);
  set("--popover", theme.surface);
  set("--popover-foreground", theme.text);
  set("--border", theme.border);
  set("--input", theme.border);
  set("--muted-foreground", theme.muted);
  set("--primary", theme.primary);
  set("--ring", theme.primary);
  set("--dash-accent", theme.primary, true);
  theme.palette?.forEach((entry, index) => {
    set(`--dash-color-${index + 1}`, entry);
  });
  if (theme.text || theme.background) {
    set("--muted", "color-mix(in oklab, var(--foreground) 7%, transparent)");
    set("--accent", "color-mix(in oklab, var(--foreground) 8%, transparent)");
    set("--accent-foreground", "var(--foreground)");
    set("--dash-grid", "color-mix(in oklab, var(--foreground) 9%, transparent)");
    set("--dash-axis", "color-mix(in oklab, var(--foreground) 20%, transparent)");
    set("--dash-track", "color-mix(in oklab, var(--foreground) 7%, transparent)");
  }
  if (theme.radius !== undefined) set("--dash-radius", `${theme.radius}px`);
  if (theme.density) set("--dash-pad", DENSITY_PADDING[theme.density]);
  const rules: string[] = [];
  if (vars.length || theme.font || theme.background)
    rules.push(
      `.dashboard-surface {\n${vars.join("\n")}${theme.background ? "\n  background: var(--background);" : ""}${theme.text ? "\n  color: var(--foreground);" : ""}${theme.font ? `\n  font-family: ${FONT_STACK[theme.font]};` : ""}\n}`,
    );
  if (theme.radius !== undefined)
    rules.push(".dashboard-widget { border-radius: var(--dash-radius); }");
  if (theme.density) rules.push(".dashboard-widget { padding: var(--dash-pad); }");
  if (theme.card === "elevated")
    rules.push(
      ".dashboard-widget { border-color: transparent; box-shadow: 0 1px 2px #0000000f, 0 8px 24px #0000001a; }",
    );
  if (theme.card === "flat")
    rules.push(".dashboard-widget { border-color: transparent; box-shadow: none; }");
  if (theme.card === "glass")
    rules.push(
      ".dashboard-widget { background: color-mix(in oklab, var(--card) 72%, transparent); backdrop-filter: blur(14px); border-color: color-mix(in oklab, var(--foreground) 12%, transparent); }",
    );
  return rules.length ? `${rules.join("\n")}\n` : "";
}

export interface ThemePreset {
  name: string;
  theme: DashboardTheme;
}

export const THEME_PRESETS: ThemePreset[] = [
  {
    name: "Corporate",
    theme: {
      primary: "#1d4ed8",
      background: "#f4f6fb",
      surface: "#ffffff",
      text: "#0f172a",
      muted: "#64748b",
      border: "#e2e8f0",
      palette: [
        "#1d4ed8",
        "#0ea5e9",
        "#14b8a6",
        "#f59e0b",
        "#8b5cf6",
        "#ef4444",
        "#64748b",
        "#22c55e",
      ],
      font: "inter",
      radius: 12,
      card: "elevated",
      density: "normal",
    },
  },
  {
    name: "Nachtblau",
    theme: {
      primary: "#38bdf8",
      background: "#0b1220",
      surface: "#111a2e",
      text: "#e2e8f0",
      muted: "#94a3b8",
      border: "#1e293b",
      palette: [
        "#38bdf8",
        "#a78bfa",
        "#34d399",
        "#fbbf24",
        "#f472b6",
        "#fb7185",
        "#94a3b8",
        "#2dd4bf",
      ],
      font: "inter",
      radius: 14,
      card: "outlined",
      density: "normal",
    },
  },
  {
    name: "Editorial",
    theme: {
      primary: "#b45309",
      background: "#faf7f2",
      surface: "#fffdf9",
      text: "#292524",
      muted: "#78716c",
      border: "#e7e0d6",
      palette: [
        "#b45309",
        "#0f766e",
        "#7c2d12",
        "#a16207",
        "#4d7c0f",
        "#9f1239",
        "#57534e",
        "#1e40af",
      ],
      font: "serif",
      radius: 4,
      card: "flat",
      density: "spacious",
    },
  },
  {
    name: "Frisch",
    theme: {
      primary: "#059669",
      background: "#f0fdf4",
      surface: "#ffffff",
      text: "#052e16",
      muted: "#4d7c5f",
      border: "#d1fae5",
      palette: [
        "#059669",
        "#0284c7",
        "#d97706",
        "#7c3aed",
        "#db2777",
        "#65a30d",
        "#0891b2",
        "#dc2626",
      ],
      font: "rounded",
      radius: 18,
      card: "elevated",
      density: "normal",
    },
  },
  {
    name: "Glas",
    theme: {
      primary: "#c084fc",
      background: "#14112a",
      surface: "#221d40",
      text: "#f5f3ff",
      muted: "#c4b5fd",
      border: "#3b3366",
      palette: [
        "#c084fc",
        "#22d3ee",
        "#f472b6",
        "#facc15",
        "#4ade80",
        "#fb923c",
        "#818cf8",
        "#f87171",
      ],
      font: "system",
      radius: 20,
      card: "glass",
      density: "normal",
    },
  },
];

export function mergeTheme(
  current: DashboardTheme | null | undefined,
  patch: Partial<Record<keyof DashboardTheme, unknown>>,
): DashboardTheme | null {
  const next: Record<string, unknown> = { ...(current ?? {}) };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined || value === "") delete next[key];
    else next[key] = value;
  }
  return sanitizeTheme(next);
}
