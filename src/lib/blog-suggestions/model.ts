import compare from "semver/functions/compare";
import parse from "semver/functions/parse";
import valid from "semver/functions/valid";
import { websiteUrl } from "@/lib/website";

export const FEED_PATH = "/blog/feed.json";
export const DAY = 86_400_000;
export const MAX_POSTS = 20;
export const MAX_FEED_BYTES = 256_000;
export const FETCH_INTERVAL = 12 * 60 * 60 * 1000;
export const COOLDOWN = 3 * DAY;
export const DISPLAY_MS = 30_000;

export interface BlogPost {
  slug: string;
  url: string;
  title: string;
  summary: string;
  publishedAt: string;
  readingMinutes: number;
  image: string | null;
  imageAlt: string | null;
  tags: string[];
  suggest: { until: string; priority: number; minAppVersion: string | null };
}

export type BlogHistory = Record<string, { status: "seen" | "dismissed" | "read"; at: number }>;

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, max: number): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= max &&
    !/[\p{Cc}‪-‮⁦-⁩]/u.test(value)
  );
}

function day(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

export function localDay(now: number): string {
  const date = new Date(now);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function siteUrl(): URL {
  return new URL(websiteUrl());
}

function sameOrigin(value: unknown, site: URL): URL | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return url.origin === site.origin && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

export function articleUrl(value: unknown, site = siteUrl()): string | null {
  const url = sameOrigin(value, site);
  return url?.pathname.startsWith("/blog/") && url.pathname.length > 6 ? url.href : null;
}

function imageUrl(value: unknown, site: URL): string | null {
  const url = sameOrigin(value, site);
  const local = site.protocol === "http:" && site.hostname === "localhost";
  return url && (url.protocol === "https:" || local) ? url.href : null;
}

function suggestion(value: unknown): BlogPost["suggest"] | null | undefined {
  if (value === null) return null;
  if (
    !object(value) ||
    !day(value.until) ||
    !Number.isInteger(value.priority) ||
    Math.abs(Number(value.priority)) > 1_000_000 ||
    (value.minAppVersion !== null &&
      (!text(value.minAppVersion, 32) || !valid(value.minAppVersion)))
  )
    return undefined;
  return {
    until: value.until,
    priority: Number(value.priority),
    minAppVersion: value.minAppVersion as string | null,
  };
}

export function parsePost(
  value: unknown,
  site = siteUrl(),
): (Omit<BlogPost, "suggest"> & { suggest: BlogPost["suggest"] | null }) | null {
  if (!object(value)) return null;
  const url = articleUrl(value.url, site);
  const image = value.image === null ? null : imageUrl(value.image, site);
  const suggest = suggestion(value.suggest);
  if (
    !text(value.slug, 120) ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.slug) ||
    !url ||
    !text(value.title, 140) ||
    !text(value.summary, 320) ||
    !day(value.publishedAt) ||
    !Number.isInteger(value.readingMinutes) ||
    Number(value.readingMinutes) < 1 ||
    Number(value.readingMinutes) > 240 ||
    (value.image !== null && !image) ||
    (value.imageAlt !== null && !text(value.imageAlt, 240)) ||
    !Array.isArray(value.tags) ||
    value.tags.length > 20 ||
    !value.tags.every((tag) => text(tag, 40)) ||
    suggest === undefined
  )
    return null;
  return {
    slug: value.slug,
    url,
    title: value.title.trim(),
    summary: value.summary.trim(),
    publishedAt: value.publishedAt,
    readingMinutes: Number(value.readingMinutes),
    image,
    imageAlt: image ? ((value.imageAlt as string | null) ?? null) : null,
    tags: value.tags as string[],
    suggest,
  };
}

export function parseBlogFeed(value: unknown, site = siteUrl()): BlogPost[] {
  if (
    !object(value) ||
    value.schemaVersion !== 1 ||
    !text(value.generatedAt, 40) ||
    !Number.isFinite(Date.parse(value.generatedAt)) ||
    !Array.isArray(value.items) ||
    value.items.length > MAX_POSTS
  )
    throw new Error("Ungültiger Blog-Feed");
  const slugs = new Set<string>();
  const posts: BlogPost[] = [];
  for (const item of value.items) {
    const post = parsePost(item, site);
    if (!post || slugs.has(post.slug)) continue;
    slugs.add(post.slug);
    if (post.suggest) posts.push(post as BlogPost);
  }
  return posts;
}

function release(version: string | null): string | null {
  const parsed = version ? parse(version) : null;
  return parsed ? `${parsed.major}.${parsed.minor}.${parsed.patch}` : null;
}

export function eligiblePosts(
  posts: BlogPost[],
  history: BlogHistory,
  version: string | null,
  now = Date.now(),
): BlogPost[] {
  const today = localDay(now);
  const current = release(version);
  return posts
    .filter(
      (post) =>
        !history[post.slug] &&
        post.publishedAt <= today &&
        post.suggest.until >= today &&
        (!post.suggest.minAppVersion ||
          (current !== null && compare(current, post.suggest.minAppVersion) >= 0)),
    )
    .sort(
      (a, b) =>
        b.suggest.priority - a.suggest.priority ||
        b.publishedAt.localeCompare(a.publishedAt) ||
        a.slug.localeCompare(b.slug),
    );
}

export function nextSuggestion(
  posts: BlogPost[],
  history: BlogHistory,
  lastShownAt: number,
  version: string | null,
  now = Date.now(),
): BlogPost | null {
  if (now - lastShownAt < COOLDOWN) return null;
  return eligiblePosts(posts, history, version, now)[0] ?? null;
}
