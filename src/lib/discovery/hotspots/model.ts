import compare from "semver/functions/compare";
import parse from "semver/functions/parse";
import type { FeatureEntry } from "../types";

export interface HotspotFilter {
  usage: Readonly<Record<string, unknown>>;
  dismissed: readonly string[];
  version: string | null;
  easyMode: boolean;
}

export function hotspotCandidates(
  entries: readonly FeatureEntry[],
  { usage, dismissed, version, easyMode }: HotspotFilter,
): FeatureEntry[] {
  const current = version ? parse(version) : null;
  if (!current) return [];
  const hidden = new Set(dismissed);
  const result: { entry: FeatureEntry; since: string }[] = [];
  for (const entry of entries) {
    if (entry.size !== "major" || !entry.since) continue;
    const since = parse(entry.since);
    if (!since || since.major !== current.major) continue;
    if (since.minor !== current.minor && since.minor !== current.minor - 1) continue;
    if (usage[entry.id] !== undefined || hidden.has(entry.id)) continue;
    if (easyMode && entry.hiddenInEasyMode) continue;
    result.push({ entry, since: since.version });
  }
  return result.sort((a, b) => compare(b.since, a.since)).map((item) => item.entry);
}

export function selectHotspot<T>(
  candidates: readonly FeatureEntry[],
  find: (entry: FeatureEntry) => T | null,
): { entry: FeatureEntry; element: T } | null {
  for (const entry of candidates) {
    const element = find(entry);
    if (element) return { entry, element };
  }
  return null;
}
