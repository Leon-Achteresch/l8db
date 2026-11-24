import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import {
  type AppTheme,
  newCustomThemeId,
  normalizeCustomTheme,
  THEME_COLOR_TOKENS,
  type ThemeVariant,
} from "@/lib/app-themes";

export const MAX_THEME_FILE = 64 * 1024;

export interface ThemeFile {
  format: "l8db-theme";
  version: 1;
  name: string;
  light: ThemeVariant;
  dark: ThemeVariant;
}

export function themeFile(theme: AppTheme): ThemeFile {
  return {
    format: "l8db-theme",
    version: 1,
    name: theme.name,
    light: structuredClone(theme.light),
    dark: structuredClone(theme.dark),
  };
}

export function serializeThemeFile(theme: AppTheme): string {
  return `${JSON.stringify(themeFile(theme), null, 2)}\n`;
}

export function parseThemeFile(text: string): AppTheme {
  if (text.length > MAX_THEME_FILE) throw new Error("Die Theme-Datei ist zu groß.");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  let value: unknown;
  try {
    value = start >= 0 && end > start ? JSON.parse(text.slice(start, end + 1)) : null;
  } catch {
    value = null;
  }
  const raw = value as Partial<ThemeFile> | null;
  if (
    !raw ||
    (raw.format !== undefined && raw.format !== "l8db-theme") ||
    (raw.version !== undefined && raw.version !== 1) ||
    !raw.light ||
    !raw.dark
  )
    throw new Error("Kein gültiges l8db-Theme.");
  const theme = normalizeCustomTheme(
    {
      ...raw,
      name: typeof raw.name === "string" && raw.name.trim() ? raw.name : "Importiertes Theme",
    },
    newCustomThemeId(),
  );
  if (!theme) throw new Error("Kein gültiges l8db-Theme.");
  return theme;
}

export async function pickAndReadTheme(): Promise<AppTheme | null> {
  const path = await open({
    multiple: false,
    directory: false,
    filters: [{ name: "l8db-Theme", extensions: ["json"] }],
  });
  return typeof path === "string" ? parseThemeFile(await readTextFile(path)) : null;
}

export async function pickAndWriteTheme(theme: AppTheme): Promise<string | null> {
  const path = await save({
    defaultPath: `${theme.name.replace(/[^\w-]+/g, "_") || "theme"}.theme.json`,
    filters: [{ name: "l8db-Theme", extensions: ["json"] }],
  });
  if (path) await writeTextFile(path, serializeThemeFile(theme));
  return path;
}

export const THEME_FORMAT_GUIDE = `Ein l8db-Theme ist JSON in genau diesem Format:
{
  "format": "l8db-theme",
  "version": 1,
  "name": "<kurzer Name>",
  "light": { "hue": <0-360>, "chroma": <0-0.4>, "tint": <0-5>, "surfaceHue": <0-360, optional>, "colors": { ... } },
  "dark": { gleiche Felder für den dunklen Modus }
}
hue ist der Farbton der Akzentfarbe, chroma ihre Sättigung (typisch 0.05-0.14), tint die Tönung der Flächen (0 = neutral grau, 2-3 = deutlich getönt), surfaceHue der Farbton der Flächen.
"colors" ist optional und überschreibt einzelne Farben als CSS-Farbe (Hex oder oklch(L C H), z. B. "#1e1e2e" oder "oklch(0.62 0.14 250)"). Erlaubte Schlüssel: ${THEME_COLOR_TOKENS.join(", ")}.
Jede *-foreground-Farbe ist die Textfarbe auf der gleichnamigen Fläche und braucht guten Kontrast (WCAG AA). "light" braucht helle Flächen und dunklen Text, "dark" dunkle Flächen und hellen Text.`;

export function themeAiPrompt(description: string): string {
  return `Erstelle ein Farb-Theme für die Datenbank-App l8db.\n\n${THEME_FORMAT_GUIDE}\n\nGib alle Farben in "colors" für beide Modi an. Antworte nur mit dem JSON, ohne Erklärung.\n\nWunsch: ${description.trim() || "ein stimmiges, gut lesbares Theme"}`;
}
