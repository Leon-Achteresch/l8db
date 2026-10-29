import { readLimited } from "@/lib/extensions/market";
import {
  catalogFileUrl,
  MAX_CATALOG_BYTES,
  MAX_PLUGIN_BYTES,
  MAX_SCREENSHOT_BYTES,
  type UiPluginCatalog,
  type UiPluginCatalogEntry,
  validateCatalog,
} from "../../../packages/ui-plugin-api/src/catalog";

export type { UiPluginCatalog, UiPluginCatalogEntry };

export const UI_PLUGIN_REPOSITORY = "https://github.com/Leon-Achteresch/l8db-ui-plugins";
export const UI_PLUGIN_CATALOG_URL =
  "https://raw.githubusercontent.com/Leon-Achteresch/l8db-ui-plugins/catalog/catalog.json";

const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  webp: "image/webp",
  jpg: "image/jpeg",
};

async function download(fetcher: typeof fetch, url: string, limit: number, timeout: number) {
  const response = await fetcher(url, {
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(timeout),
  });
  return readLimited(response, limit);
}

async function sha256(bytes: Uint8Array<ArrayBuffer>) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function loadUiPluginCatalog(
  fetcher: typeof fetch = fetch,
  catalogUrl = UI_PLUGIN_CATALOG_URL,
): Promise<UiPluginCatalog> {
  const bytes = await download(fetcher, catalogUrl, MAX_CATALOG_BYTES, 10000);
  return validateCatalog(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
}

export function catalogPluginFileName(entry: UiPluginCatalogEntry) {
  const name = `${entry.id}${entry.file.slice(entry.file.lastIndexOf("."))}`;
  if (name.length > 85) throw new Error(`Plugin-ID ${entry.id} ist für einen Dateinamen zu lang.`);
  return name;
}

export async function downloadUiPlugin(
  entry: UiPluginCatalogEntry,
  fetcher: typeof fetch = fetch,
  catalogUrl = UI_PLUGIN_CATALOG_URL,
): Promise<string> {
  const bytes = await download(
    fetcher,
    catalogFileUrl(catalogUrl, entry.file),
    MAX_PLUGIN_BYTES,
    15000,
  );
  if ((await sha256(bytes)) !== entry.sha256)
    throw new Error("Plugin-Hash stimmt nicht mit dem Katalog überein.");
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export async function downloadUiPluginScreenshot(
  entry: UiPluginCatalogEntry,
  fetcher: typeof fetch = fetch,
  catalogUrl = UI_PLUGIN_CATALOG_URL,
): Promise<Blob | null> {
  if (!entry.screenshot) return null;
  const type = IMAGE_TYPES[entry.screenshot.slice(entry.screenshot.lastIndexOf(".") + 1)];
  const bytes = await download(
    fetcher,
    catalogFileUrl(catalogUrl, entry.screenshot),
    MAX_SCREENSHOT_BYTES,
    15000,
  );
  return new Blob([bytes], { type });
}
