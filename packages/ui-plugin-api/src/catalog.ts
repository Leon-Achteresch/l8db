import { PLUGIN_ID_PATTERN, parseHttpPattern } from "./definition";

export const MAX_CATALOG_BYTES = 512 * 1024;
export const MAX_PLUGIN_BYTES = 256 * 1024;
export const MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024;

export type UiPluginCatalogEntry = {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  file: string;
  sha256: string;
  screenshot?: string;
  tags: string[];
  http: string[];
};

export type UiPluginCatalog = { schemaVersion: 1; plugins: UiPluginCatalogEntry[] };

const RELATIVE_FILE =
  /^plugins\/[a-z0-9][a-z0-9.-]{0,120}\/[A-Za-z0-9][A-Za-z0-9._-]{0,80}\.(tsx|ts|jsx|js|png|webp|jpg)$/;

function text(value: unknown, path: string, max: number, required = true): string {
  if (value === undefined && !required) return "";
  if (typeof value !== "string" || (required && !value.trim()) || value.length > max)
    throw new Error(`Katalog: ${path} ist ungültig.`);
  return value;
}

export function validateCatalog(value: unknown): UiPluginCatalog {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("Katalog: kein Objekt.");
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== 1) throw new Error("Katalog: schemaVersion 1 erwartet.");
  if (!Array.isArray(record.plugins) || record.plugins.length > 500)
    throw new Error("Katalog: plugins fehlt oder hat mehr als 500 Einträge.");
  const seen = new Set<string>();
  const plugins = record.plugins.map((raw, index) => {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw))
      throw new Error(`Katalog: plugins[${index}] ist kein Objekt.`);
    const entry = raw as Record<string, unknown>;
    const id = text(entry.id, `plugins[${index}].id`, 120);
    if (!PLUGIN_ID_PATTERN.test(id) || seen.has(id))
      throw new Error(`Katalog: id "${id}" ist ungültig oder doppelt.`);
    seen.add(id);
    const file = text(entry.file, `${id}.file`, 300);
    if (!RELATIVE_FILE.test(file) || /\.(png|webp|jpg)$/.test(file))
      throw new Error(`Katalog: ${id}.file ist ungültig.`);
    const sha256 = text(entry.sha256, `${id}.sha256`, 64);
    if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error(`Katalog: ${id}.sha256 ist ungültig.`);
    const screenshot = text(entry.screenshot, `${id}.screenshot`, 300, false) || undefined;
    if (screenshot && (!RELATIVE_FILE.test(screenshot) || !/\.(png|webp|jpg)$/.test(screenshot)))
      throw new Error(`Katalog: ${id}.screenshot ist ungültig.`);
    const list = (field: string, max: number) => {
      const values = entry[field] ?? [];
      if (
        !Array.isArray(values) ||
        values.length > max ||
        values.some((item) => typeof item !== "string" || item.length > 300)
      )
        throw new Error(`Katalog: ${id}.${field} ist ungültig.`);
      return values as string[];
    };
    const http = list("http", 20);
    if (http.some((pattern) => !parseHttpPattern(pattern)))
      throw new Error(`Katalog: ${id}.http ist ungültig.`);
    return {
      id,
      name: text(entry.name, `${id}.name`, 80),
      description: text(entry.description, `${id}.description`, 500, false),
      version: text(entry.version, `${id}.version`, 40),
      author: text(entry.author, `${id}.author`, 80, false),
      file,
      sha256,
      screenshot,
      tags: list("tags", 10),
      http,
    };
  });
  return { schemaVersion: 1, plugins };
}

export function catalogFileUrl(catalogUrl: string, file: string): string {
  const base = new URL(catalogUrl);
  const target = new URL(file, base);
  const root = base.href.slice(0, base.href.lastIndexOf("/") + 1);
  if (
    target.origin !== base.origin ||
    !target.href.startsWith(root) ||
    target.search ||
    target.hash
  )
    throw new Error("Katalog: Datei liegt außerhalb des Katalogs.");
  return target.href;
}
