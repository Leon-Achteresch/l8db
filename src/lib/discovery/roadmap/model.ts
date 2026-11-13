export const ROADMAP_REPOSITORY = "Leon-Achteresch/l8db";
export const ROADMAP_TAG = "roadmap";
export const ROADMAP_URL = `https://api.github.com/repos/${ROADMAP_REPOSITORY}/releases/tags/${ROADMAP_TAG}`;
export const ROADMAP_TIMEOUT_MS = 8000;
export const ROADMAP_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const ROADMAP_MANUAL_MS = 60_000;
export const ROADMAP_CACHE_MS = 48 * 60 * 60 * 1000;
export const ROADMAP_MAX_BYTES = 200_000;
export const ROADMAP_MAX_RAW_ITEMS = 1000;
export const ROADMAP_MAX_ITEMS = 100;
export const ROADMAP_STATUSES = ["geplant", "in-arbeit", "erschienen"] as const;

export type RoadmapStatus = (typeof ROADMAP_STATUSES)[number];

export interface RoadmapItem {
  id: string;
  title: string;
  summary: string;
  status: RoadmapStatus;
  issue?: number;
  votes?: number;
  eta?: string;
}

export interface RoadmapFeed {
  schemaVersion: 1;
  items: RoadmapItem[];
}

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

function text(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

function count(value: unknown, min: number): value is number {
  return Number.isInteger(value) && (value as number) >= min && (value as number) <= 10_000_000;
}

function parseItem(raw: unknown): RoadmapItem | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const item = raw as Record<string, unknown>;
  if (
    !text(item.id, 64) ||
    !ID.test(item.id) ||
    !text(item.title, 80) ||
    !text(item.summary, 400) ||
    !ROADMAP_STATUSES.includes(item.status as RoadmapStatus) ||
    (item.issue !== undefined && !count(item.issue, 1)) ||
    (item.votes !== undefined && !count(item.votes, 0)) ||
    (item.eta !== undefined && !text(item.eta, 32))
  )
    return null;
  const result: RoadmapItem = {
    id: item.id,
    title: item.title.trim(),
    summary: item.summary.trim(),
    status: item.status as RoadmapStatus,
  };
  if (item.issue !== undefined) result.issue = item.issue as number;
  if (item.votes !== undefined) result.votes = item.votes as number;
  if (item.eta !== undefined) result.eta = (item.eta as string).trim();
  return result;
}

export function parseRoadmap(value: unknown): RoadmapFeed {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Ungültiger Roadmap-Feed");
  const feed = value as Record<string, unknown>;
  if (feed.schemaVersion !== 1) throw new Error("Unbekannte Roadmap-Version");
  if (!Array.isArray(feed.items) || feed.items.length > ROADMAP_MAX_RAW_ITEMS)
    throw new Error("Ungültige Roadmap-Einträge");
  const ids = new Set<string>();
  const items: RoadmapItem[] = [];
  for (const raw of feed.items) {
    const item = parseItem(raw);
    if (!item || ids.has(item.id)) continue;
    ids.add(item.id);
    items.push(item);
    if (items.length >= ROADMAP_MAX_ITEMS) break;
  }
  return { schemaVersion: 1, items };
}

export function parseRoadmapRelease(raw: string): RoadmapFeed {
  const release = JSON.parse(raw);
  if (
    !release ||
    release.draft ||
    release.tag_name !== ROADMAP_TAG ||
    typeof release.body !== "string" ||
    release.body.length > ROADMAP_MAX_BYTES
  )
    throw new Error("Ungültiger Roadmap-Release");
  const body = release.body.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/, "$1");
  return parseRoadmap(JSON.parse(body));
}
