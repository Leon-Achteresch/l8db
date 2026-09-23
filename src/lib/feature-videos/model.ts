import { compare, prerelease, valid } from "semver";

export const MEDIA_REPOSITORY = "Leon-Achteresch/l8db";
export const MEDIA_TAG = "feature-videos";
export const FEED_URL = `https://api.github.com/repos/${MEDIA_REPOSITORY}/releases/tags/${MEDIA_TAG}`;
export const ASSET_BASE = `https://github.com/${MEDIA_REPOSITORY}/releases/download/`;

export function clipTag(item: { id: string; revision: string }): string {
  return `feature-video-${item.id}-${item.revision}`;
}
export const DAY = 86_400_000;
export const MAX_CLIPS = 6;
export const MAX_AGE = 90 * DAY;
export const FEED_LIFETIME = 2 * DAY;
export const ACTIONS = ["settings", "extensions", "compare"] as const;

export interface FeatureVideo {
  id: string;
  revision: string;
  title: string;
  summary: string;
  releaseVersion: string;
  sourceCommit: string;
  minAppVersion: string;
  maxAppVersionExclusive?: string;
  publishedAt: string;
  expiresAt: string;
  priority: number;
  platforms: string[];
  requiredCapabilities: string[];
  modes: string[];
  actionId: (typeof ACTIONS)[number];
  durationSeconds: number;
  poster: string;
  sources: { url: string; type: string; bytes: number }[];
}

export interface FeatureVideoFeed {
  schemaVersion: 1;
  generatedAt: string;
  validUntil: string;
  items: FeatureVideo[];
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function list(value: unknown, allowed?: readonly string[]): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= 64 &&
    value.every(
      (item) => text(item, 64) && /^[a-z_]+$/.test(item) && (!allowed || allowed.includes(item)),
    )
  );
}

export function isMediaUrl(value: unknown, extension: string): value is string {
  return (
    typeof value === "string" &&
    value.startsWith(ASSET_BASE) &&
    new RegExp(`^feature-video-[a-z0-9-]+/fv-[a-z0-9-]+\\.${extension}$`).test(
      value.slice(ASSET_BASE.length),
    )
  );
}

export function parseFeed(
  value: unknown,
  now = Date.now(),
  allowExpired = false,
): FeatureVideoFeed {
  if (
    !object(value) ||
    value.schemaVersion !== 1 ||
    !text(value.generatedAt, 40) ||
    !text(value.validUntil, 40) ||
    !Array.isArray(value.items) ||
    value.items.length > MAX_CLIPS
  ) {
    throw new Error("Ungültiger Feature-Feed");
  }
  const generated = Date.parse(value.generatedAt);
  const until = Date.parse(value.validUntil);
  if (
    !Number.isFinite(generated) ||
    !Number.isFinite(until) ||
    generated > now + 300_000 ||
    until <= generated ||
    until - generated > FEED_LIFETIME ||
    (!allowExpired && until <= now)
  ) {
    throw new Error("Feature-Feed ist abgelaufen");
  }
  const ids = new Set<string>();
  for (const item of value.items) {
    if (
      !object(item) ||
      !text(item.id, 64) ||
      !/^[a-z0-9-]+$/.test(item.id) ||
      ids.has(item.id) ||
      !text(item.revision, 64) ||
      !/^[a-z0-9-]+$/.test(item.revision) ||
      !text(item.title, 80) ||
      !text(item.summary, 240) ||
      !text(item.sourceCommit, 40) ||
      !/^[a-f0-9]{7,40}$/.test(item.sourceCommit) ||
      !text(item.releaseVersion, 32) ||
      !valid(item.releaseVersion) ||
      prerelease(item.releaseVersion) ||
      !text(item.minAppVersion, 32) ||
      !valid(item.minAppVersion) ||
      (item.maxAppVersionExclusive !== undefined &&
        (!text(item.maxAppVersionExclusive, 32) || !valid(item.maxAppVersionExclusive))) ||
      !text(item.publishedAt, 40) ||
      !text(item.expiresAt, 40) ||
      !Number.isInteger(item.priority) ||
      Number(item.priority) < 0 ||
      Number(item.priority) > 100 ||
      !list(item.platforms, ["macos", "windows", "linux"]) ||
      !item.platforms.length ||
      !list(item.modes, ["easy", "normal"]) ||
      !item.modes.length ||
      !list(item.requiredCapabilities) ||
      !ACTIONS.includes(item.actionId as (typeof ACTIONS)[number]) ||
      typeof item.durationSeconds !== "number" ||
      item.durationSeconds < 1 ||
      item.durationSeconds > 30 ||
      !isMediaUrl(item.poster, "jpg") ||
      !Array.isArray(item.sources) ||
      item.sources.length !== 2
    ) {
      throw new Error("Ungültiger Feature-Eintrag");
    }
    const prefix = `${ASSET_BASE}${clipTag({ id: item.id, revision: item.revision })}/fv-${item.id}-${item.revision}.`;
    if (
      item.poster !== `${prefix}jpg` ||
      item.sources.some(
        (source) =>
          !object(source) ||
          source.url !== `${prefix}${source.type === "video/mp4" ? "mp4" : "webm"}`,
      )
    )
      throw new Error("Medien gehören nicht zum Feature");
    const published = Date.parse(item.publishedAt);
    const expires = Date.parse(item.expiresAt);
    if (
      !Number.isFinite(published) ||
      !Number.isFinite(expires) ||
      expires <= published ||
      expires - published > MAX_AGE ||
      compare(item.minAppVersion, item.releaseVersion) < 0 ||
      (item.maxAppVersionExclusive &&
        compare(item.maxAppVersionExclusive as string, item.minAppVersion) <= 0)
    ) {
      throw new Error("Ungültiges Feature-Zeitfenster");
    }
    const types = new Set<string>();
    for (const source of item.sources) {
      if (
        !object(source) ||
        !["video/mp4", "video/webm"].includes(String(source.type)) ||
        !isMediaUrl(source.url, source.type === "video/mp4" ? "mp4" : "webm") ||
        !Number.isInteger(source.bytes) ||
        Number(source.bytes) <= 0 ||
        Number(source.bytes) > 5_000_000 ||
        types.has(String(source.type))
      ) {
        throw new Error("Ungültige Videoquelle");
      }
      types.add(String(source.type));
    }
    ids.add(item.id);
  }
  return value as unknown as FeatureVideoFeed;
}

export interface VideoContext {
  version: string | null;
  platform: string;
  easyMode: boolean;
  capabilities: Record<string, unknown>;
  now?: number;
}

export function eligibleVideos(
  feed: FeatureVideoFeed | null,
  context: VideoContext,
): FeatureVideo[] {
  const now = context.now ?? Date.now();
  if (
    !feed ||
    Date.parse(feed.validUntil) <= now ||
    !context.version ||
    !valid(context.version) ||
    prerelease(context.version)
  )
    return [];
  const version = context.version;
  return feed.items
    .filter(
      (item) =>
        Date.parse(item.publishedAt) <= now &&
        Date.parse(item.expiresAt) > now &&
        compare(version, item.minAppVersion) >= 0 &&
        (!item.maxAppVersionExclusive || compare(version, item.maxAppVersionExclusive) < 0) &&
        item.platforms.includes(context.platform) &&
        item.modes.includes(context.easyMode ? "easy" : "normal") &&
        item.requiredCapabilities.every((key) => context.capabilities[key] === true),
    )
    .sort(
      (a, b) => b.priority - a.priority || Date.parse(b.publishedAt) - Date.parse(a.publishedAt),
    );
}
