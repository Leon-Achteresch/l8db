import { featureAvailable, featuresByArea, newestFeatures, searchFeatures } from "../catalog";
import type { FeatureArea, FeatureEntry, FeatureSearchOptions } from "../types";
import type { FeatureUsage } from "../usage";

export const ATLAS_FILTERS = [
  { id: "all", label: "Alle" },
  { id: "unused", label: "Noch nie genutzt" },
  { id: "new", label: "Neu" },
  { id: "major", label: "Groß" },
] as const;

export type AtlasFilter = (typeof ATLAS_FILTERS)[number]["id"];

export const ATLAS_NEW_LIMIT = 6;

export interface AtlasProgress {
  used: number;
  total: number;
  percent: number;
}

export function atlasAvailable(
  entries: readonly FeatureEntry[],
  options: Pick<FeatureSearchOptions, "capabilities" | "easyMode">,
): FeatureEntry[] {
  return entries.filter((entry) => featureAvailable(entry, options));
}

export function atlasProgress(
  available: readonly FeatureEntry[],
  usage: FeatureUsage,
): AtlasProgress {
  let used = 0;
  for (const entry of available) if (usage[entry.id]) used++;
  const total = available.length;
  return { used, total, percent: total === 0 ? 0 : Math.round((used / total) * 100) };
}

export function atlasNewIds(entries: readonly FeatureEntry[]): Set<string> {
  return new Set(newestFeatures(ATLAS_NEW_LIMIT, entries).map((entry) => entry.id));
}

export function filterAtlas(
  available: readonly FeatureEntry[],
  {
    filter,
    query,
    usage,
    newIds,
  }: { filter: AtlasFilter; query: string; usage: FeatureUsage; newIds: ReadonlySet<string> },
): FeatureEntry[] {
  const base = query.trim()
    ? searchFeatures(query, { limit: available.length }, available)
    : available;
  if (filter === "all") return [...base];
  return base.filter((entry) =>
    filter === "unused"
      ? !usage[entry.id]
      : filter === "new"
        ? newIds.has(entry.id)
        : entry.size === "major",
  );
}

export function groupAtlas(entries: readonly FeatureEntry[]): [FeatureArea, FeatureEntry[]][] {
  return [...featuresByArea(entries)].filter(([, list]) => list.length > 0);
}
