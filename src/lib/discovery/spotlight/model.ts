import compare from "semver/functions/compare";
import parse from "semver/functions/parse";
import { FEATURE_AREAS, type FeatureArea, type FeatureEntry } from "../types";

export const DAY_MS = 86_400_000;
export const AWAY_MS = 21 * DAY_MS;
export const SPOTLIGHT_CARDS = 3;

export type SpotlightKind = "spotlight" | "welcomeBack";

export interface SpotlightGroup {
  area: FeatureArea;
  entries: FeatureEntry[];
}

export interface SpotlightContent {
  kind: SpotlightKind;
  label: string;
  major: FeatureEntry[];
  others: SpotlightGroup[];
}

export type SpotlightDecision =
  | { action: "none" }
  | { action: "remember"; version: string }
  | { action: "show"; version: string; content: SpotlightContent };

export interface SpotlightInput {
  current: string | null;
  seen: string | null;
  lastActive: number | null;
  now: number;
  onboardingDone: boolean;
  entries: readonly FeatureEntry[];
  dev?: boolean;
  sessionShown?: boolean;
}

function release(version: string | null | undefined) {
  const parsed = version ? parse(version) : null;
  return parsed && parsed.prerelease.length === 0 ? parsed : null;
}

const keys = new Map<string, number | null>();

function releaseKey(version: string | undefined): number | null {
  if (!version) return null;
  let key = keys.get(version);
  if (key === undefined) {
    const parsed = release(version);
    key =
      parsed && parsed.minor < 10_000 && parsed.patch < 10_000
        ? parsed.major * 1e8 + parsed.minor * 1e4 + parsed.patch
        : null;
    if (keys.size >= 1024) keys.clear();
    keys.set(version, key);
  }
  return key;
}

export function minorLabel(version: string): string {
  const parsed = parse(version);
  return parsed ? `${parsed.major}.${parsed.minor}` : version;
}

export function featuresBetween(
  entries: readonly FeatureEntry[],
  from: string,
  to: string,
): FeatureEntry[] {
  const low = releaseKey(from);
  const high = releaseKey(to);
  if (low === null || high === null) return [];
  const result: { entry: FeatureEntry; since: number }[] = [];
  for (const entry of entries) {
    const since = releaseKey(entry.since);
    if (since !== null && since > low && since <= high) result.push({ entry, since });
  }
  return result.sort((a, b) => b.since - a.since).map((item) => item.entry);
}

export function spotlightContent(
  kind: SpotlightKind,
  entries: readonly FeatureEntry[],
  from: string,
  to: string,
): SpotlightContent {
  const list = featuresBetween(entries, from, to);
  const major = list.filter((entry) => entry.size === "major");
  if (kind === "spotlight")
    return { kind, label: minorLabel(to), major: major.slice(0, SPOTLIGHT_CARDS), others: [] };
  const others = FEATURE_AREAS.map((area) => ({
    area,
    entries: list.filter((entry) => entry.size !== "major" && entry.area === area),
  })).filter((group) => group.entries.length > 0);
  return { kind, label: minorLabel(from), major, others };
}

export function manualSpotlightContent(entries: readonly FeatureEntry[]): SpotlightContent | null {
  let latest: string | null = null;
  let latestKey = -1;
  for (const entry of entries) {
    const key = entry.size === "major" ? releaseKey(entry.since) : null;
    if (key !== null && key > latestKey) {
      latestKey = key;
      latest = entry.since ?? null;
    }
  }
  if (!latest) return null;
  const label = minorLabel(latest);
  const major = featuresBetween(entries, "0.0.0", latest).filter(
    (entry) => entry.size === "major" && minorLabel(entry.since ?? "") === label,
  );
  return { kind: "spotlight", label, major: major.slice(0, SPOTLIGHT_CARDS), others: [] };
}

export function decideSpotlight(input: SpotlightInput): SpotlightDecision {
  if (input.dev || input.sessionShown) return { action: "none" };
  const current = release(input.current);
  if (!current) return { action: "none" };
  const version = current.version;
  let seen = input.seen ? parse(input.seen) : null;
  if (!seen) {
    if (!input.onboardingDone || current.minor === 0) return { action: "remember", version };
    seen = parse(`${current.major}.${current.minor - 1}.0`);
    if (!seen) return { action: "remember", version };
  }
  if (seen.version === version) return { action: "none" };
  if (
    compare(version, seen.version) <= 0 ||
    (current.major === seen.major && current.minor === seen.minor)
  )
    return { action: "remember", version };
  const skipped = current.major === seen.major ? current.minor - seen.minor > 1 : current.minor > 0;
  const away = input.lastActive !== null && input.now - input.lastActive > AWAY_MS;
  const kind: SpotlightKind = skipped || away ? "welcomeBack" : "spotlight";
  const content = spotlightContent(kind, input.entries, seen.version, version);
  if (content.major.length === 0 && content.others.length === 0)
    return { action: "remember", version };
  return { action: "show", version, content };
}
