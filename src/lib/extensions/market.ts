import { valid } from "semver";
import { validateArchive } from "../../../packages/extension-api/src/manifest";
import type { ExtensionArchive } from "./contracts";

export const OFFICIAL_MARKET_URL =
  "https://raw.githubusercontent.com/Leon-Achteresch/l8db-extension-market/main/catalog.json";

const MAX_CATALOG_BYTES = 256 * 1024;
const MAX_PACKAGE_BYTES = 8 * 1024 * 1024;
const IDENTIFIER = /^[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9-]*$/;
const PACKAGE_PATH = /^packages\/[a-zA-Z0-9._-]+\.l8db-extension$/;
const SHA256 = /^[a-f0-9]{64}$/;

export interface MarketExtension {
  id: string;
  name: string;
  description: string;
  version: string;
  publisher: string;
  package: string;
  sha256: string;
}

export interface MarketCatalog {
  schemaVersion: 1;
  extensions: MarketExtension[];
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateMarketCatalog(value: unknown): MarketCatalog {
  if (!record(value) || value.schemaVersion !== 1 || !Array.isArray(value.extensions))
    throw new Error("Ungültiger Extension-Katalog.");
  if (value.extensions.length > 100) throw new Error("Extension-Katalog ist zu groß.");
  const seen = new Set<string>();
  const extensions = value.extensions.map((item) => {
    if (!record(item)) throw new Error("Ungültiger Katalogeintrag.");
    const { id, name, description, version, publisher, package: packagePath, sha256 } = item;
    if (
      typeof id !== "string" ||
      !IDENTIFIER.test(id) ||
      typeof name !== "string" ||
      !name.trim() ||
      name.length > 120 ||
      typeof description !== "string" ||
      !description.trim() ||
      description.length > 1000 ||
      typeof version !== "string" ||
      !valid(version) ||
      typeof publisher !== "string" ||
      !id.startsWith(`${publisher}.`) ||
      typeof packagePath !== "string" ||
      !PACKAGE_PATH.test(packagePath) ||
      typeof sha256 !== "string" ||
      !SHA256.test(sha256) ||
      seen.has(id)
    )
      throw new Error("Ungültiger Katalogeintrag.");
    seen.add(id);
    return { id, name, description, version, publisher, package: packagePath, sha256 };
  });
  return { schemaVersion: 1, extensions };
}

async function readLimited(response: Response, limit: number): Promise<Uint8Array> {
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > limit) throw new Error("Download ist zu groß.");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Leere Serverantwort.");
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error("Download ist zu groß.");
      parts.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return bytes;
}

function marketBase(catalogUrl: string): URL {
  const url = new URL(catalogUrl);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash)
    throw new Error("Ungültige Katalogadresse.");
  return url;
}

export async function loadMarketCatalog(
  fetcher: typeof fetch = fetch,
  catalogUrl = OFFICIAL_MARKET_URL,
): Promise<MarketCatalog> {
  const url = marketBase(catalogUrl);
  const response = await fetcher(url, {
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(10000),
  });
  const bytes = await readLimited(response, MAX_CATALOG_BYTES);
  return validateMarketCatalog(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
}

export async function downloadMarketExtension(
  entry: MarketExtension,
  fetcher: typeof fetch = fetch,
  catalogUrl = OFFICIAL_MARKET_URL,
): Promise<ExtensionArchive> {
  const catalog = marketBase(catalogUrl);
  const packageUrl = new URL(entry.package, catalog);
  if (
    packageUrl.origin !== catalog.origin ||
    !packageUrl.pathname.startsWith(
      catalog.pathname.slice(0, catalog.pathname.lastIndexOf("/") + 1),
    )
  )
    throw new Error("Paketadresse liegt außerhalb des offiziellen Repositories.");
  const response = await fetcher(packageUrl, {
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  const bytes = await readLimited(response, MAX_PACKAGE_BYTES);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const actual = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  if (actual !== entry.sha256) throw new Error("Paket-Hash stimmt nicht mit dem Katalog überein.");
  const archive = validateArchive(
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
  );
  if (
    archive.manifest.id !== entry.id ||
    archive.manifest.version !== entry.version ||
    archive.manifest.publisher !== entry.publisher
  )
    throw new Error("Paket-Metadaten stimmen nicht mit dem Katalog überein.");
  return archive;
}
