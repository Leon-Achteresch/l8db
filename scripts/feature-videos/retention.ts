import {
  ASSET_BASE,
  clipTag,
  DAY,
  FEED_LIFETIME,
  MAX_CLIPS,
  type FeatureVideo,
  type FeatureVideoFeed,
  parseFeed,
} from "../../src/lib/feature-videos/model";

export interface Registry extends FeatureVideoFeed {
  published: Record<string, { revision: string; publishedAt: string }>;
  retired: { urls: string[]; retiredAt: string }[];
}

export function assetUrls(item: FeatureVideo): string[] {
  return [item.poster, ...item.sources.map((source) => source.url)];
}

export function emptyRegistry(now: number): Registry {
  return {
    schemaVersion: 1,
    generatedAt: new Date(now).toISOString(),
    validUntil: new Date(now + FEED_LIFETIME).toISOString(),
    items: [],
    published: {},
    retired: [],
  };
}

export function readRegistry(value: unknown, now: number): Registry {
  const feed = parseFeed(value, now, true);
  const raw = value as Registry;
  if (
    !raw.published ||
    typeof raw.published !== "object" ||
    Array.isArray(raw.published) ||
    !Array.isArray(raw.retired)
  )
    throw new Error("Medienregister fehlt");
  for (const [id, entry] of Object.entries(raw.published)) {
    if (
      !/^[a-z0-9-]{1,64}$/.test(id) ||
      !entry ||
      !/^[a-z0-9-]{1,64}$/.test(entry.revision) ||
      !Number.isFinite(Date.parse(entry.publishedAt))
    )
      throw new Error("Ungültiges Veröffentlichungsregister");
  }
  for (const entry of raw.retired) {
    if (
      !entry ||
      !Number.isFinite(Date.parse(entry.retiredAt)) ||
      !Array.isArray(entry.urls) ||
      entry.urls.some(
        (url) =>
          typeof url !== "string" ||
          !url.startsWith(ASSET_BASE) ||
          !/^feature-video-[a-z0-9-]+\/fv-[a-z0-9-]+\.(mp4|webm|jpg)$/.test(
            url.slice(ASSET_BASE.length),
          ),
      )
    )
      throw new Error("Ungültiges Löschregister");
  }
  return { ...feed, published: raw.published, retired: raw.retired };
}

export function reconcile(registry: Registry, incoming: FeatureVideo[], now: number): Registry {
  const published = { ...registry.published };
  const replaced = new Set(incoming.map((item) => item.id));
  const candidates = [...registry.items.filter((item) => !replaced.has(item.id)), ...incoming];
  const items = candidates
    .filter((item) => Date.parse(item.expiresAt) > now)
    .sort(
      (a, b) => b.priority - a.priority || Date.parse(b.publishedAt) - Date.parse(a.publishedAt),
    )
    .slice(0, MAX_CLIPS);
  const activeUrls = new Set(items.flatMap(assetUrls));
  const retired = [...registry.retired];
  const retiredUrls = new Set(retired.flatMap((item) => item.urls));
  for (const item of [...registry.items, ...incoming]) {
    const urls = assetUrls(item).filter((url) => !activeUrls.has(url) && !retiredUrls.has(url));
    if (urls.length) {
      retired.push({ urls, retiredAt: new Date(now).toISOString() });
      for (const url of urls) retiredUrls.add(url);
    }
  }
  for (const item of incoming)
    published[item.id] = {
      revision: item.revision,
      publishedAt: registry.published[item.id]?.publishedAt ?? item.publishedAt,
    };
  return { ...emptyRegistry(now), items, published, retired };
}

export interface ClipRelease {
  id: number;
  tag_name: string;
  body: string;
  created_at: string;
  published_at?: string | null;
}

export function isClipRelease(release: ClipRelease): boolean {
  try {
    const marker = JSON.parse(release.body);
    return (
      marker.kind === "l8db-feature-video" &&
      /^[a-z0-9-]{1,64}$/.test(marker.id) &&
      /^[a-z0-9-]{1,64}$/.test(marker.revision) &&
      release.tag_name === clipTag(marker)
    );
  } catch {
    return false;
  }
}

export function deletableReleases(
  registry: Registry,
  releases: ClipRelease[],
  now: number,
): ClipRelease[] {
  const active = registry.items.flatMap(assetUrls);
  return releases.filter((release) => {
    if (!isClipRelease(release)) return false;
    const prefix = `${ASSET_BASE}${release.tag_name}/`;
    if (active.some((url) => url.startsWith(prefix))) return false;
    const retired = registry.retired.filter((entry) =>
      entry.urls.some((url) => url.startsWith(prefix)),
    );
    const since = retired.length
      ? Math.max(...retired.map((entry) => Date.parse(entry.retiredAt)))
      : Date.parse(release.published_at ?? release.created_at);
    return Number.isFinite(since) && now - since >= 2 * DAY;
  });
}
