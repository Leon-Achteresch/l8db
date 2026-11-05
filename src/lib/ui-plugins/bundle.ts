import type { UiPluginFile } from "@/lib/db/ui-plugins";
import type { UiPluginOptionValue } from "./settings";

export interface BundleEntry {
  name: string;
  source: string;
  options: Record<string, UiPluginOptionValue>;
  requiredHttpHosts: string[];
  error?: string;
}
export interface BundlePreview extends BundleEntry {
  key: string;
  id?: string;
  before?: string;
}
type Check = (name: string, source: string) => Promise<{ id: string; http?: string[] }>;

export function encodeBundle(plugins: BundleEntry[]) {
  if (!plugins.length) throw new Error("Keine Plugins ausgewählt.");
  const contents = JSON.stringify({ format: "l8db.ui-plugins", version: 1, plugins });
  if (new TextEncoder().encode(contents).length > 2 * 1024 * 1024)
    throw new Error("Bundle ist größer als 2 MiB.");
  return contents;
}

export async function previewBundle(value: unknown, files: UiPluginFile[], check: Check) {
  const bundle = value as { format?: unknown; version?: unknown; plugins?: unknown };
  if (
    bundle?.format !== "l8db.ui-plugins" ||
    bundle.version !== 1 ||
    !Array.isArray(bundle.plugins) ||
    bundle.plugins.length > 200
  )
    throw new Error("Ungültiges Bundle.");
  const result: BundlePreview[] = [];
  const names = new Set<string>();
  const ids = new Set<string>();
  for (const raw of bundle.plugins) {
    const entry: BundlePreview = {
      key: String(result.length),
      name: String(raw?.name ?? ""),
      source: typeof raw?.source === "string" ? raw.source : "",
      options: {},
      requiredHttpHosts: [],
    };
    try {
      if (raw?.error) throw new Error(String(raw.error));
      if (
        !/^[a-z0-9][a-z0-9._-]*\.(tsx?|jsx?)$/i.test(entry.name) ||
        entry.name.includes("..") ||
        entry.name.endsWith(".d.ts") ||
        entry.name.length > 85 ||
        names.has(entry.name.toLowerCase())
      )
        throw new Error("Ungültiger oder doppelter Dateiname.");
      names.add(entry.name.toLowerCase());
      if (
        typeof raw.source !== "string" ||
        new TextEncoder().encode(entry.source).length > 256 * 1024
      )
        throw new Error("Ungültiger Quelltext.");
      if (
        !raw.options ||
        typeof raw.options !== "object" ||
        Array.isArray(raw.options) ||
        Object.values(raw.options).some((v) => !["string", "boolean", "number"].includes(typeof v))
      )
        throw new Error("Ungültige Optionen.");
      entry.options = raw.options;
      const definition = await check(entry.name, entry.source);
      if (ids.has(definition.id)) throw new Error("Doppelte Plugin-ID.");
      ids.add(definition.id);
      entry.id = definition.id;
      entry.requiredHttpHosts = definition.http ?? [];
      entry.before = files.find(
        (file) => file.name.toLowerCase() === entry.name.toLowerCase(),
      )?.source;
    } catch (error) {
      entry.error = String(error);
    }
    result.push(entry);
  }
  return result;
}

export async function applyBundle(
  entries: BundlePreview[],
  selected: Set<string>,
  current: UiPluginFile[],
  check: Check,
  write: (entry: BundlePreview) => Promise<void>,
) {
  const chosen = entries.filter((entry) => selected.has(entry.name) && !entry.error);
  for (const entry of chosen) {
    if (
      current.find((file) => file.name.toLowerCase() === entry.name.toLowerCase())?.source !==
      entry.before
    )
      throw new Error("Plugin wurde inzwischen geändert. Import erneut öffnen.");
    await check(entry.name, entry.source);
  }
  for (const entry of chosen) await write(entry);
}
