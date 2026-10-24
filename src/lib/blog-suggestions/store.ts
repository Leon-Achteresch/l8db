import { openUrl } from "@tauri-apps/plugin-opener";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useSettingsStore } from "@/lib/settings";
import { websiteUrl } from "@/lib/website";
import { syncAcrossWindows } from "@/lib/window-sync";
import {
  articleUrl,
  type BlogHistory,
  type BlogPost,
  COOLDOWN,
  DAY,
  FEED_PATH,
  FETCH_INTERVAL,
  MAX_FEED_BYTES,
  MAX_POSTS,
  parseBlogFeed,
  parsePost,
  siteUrl,
} from "./model";

const STORAGE_KEY = "l8db.blog-suggestions";
const STATUSES = ["seen", "dismissed", "read"];

interface BlogState {
  posts: BlogPost[];
  checkedAt: number;
  history: BlogHistory;
  lastShownAt: number;
  activeSlug: string | null;
  show: (slug: string) => void;
  finish: (slug: string, status: BlogHistory[string]["status"]) => void;
}

export function pruneBlogHistory(value: unknown, now = Date.now()): BlogHistory {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([slug, item]) =>
          /^[a-z0-9-]{1,120}$/.test(slug) &&
          item &&
          typeof item === "object" &&
          STATUSES.includes(item.status) &&
          typeof item.at === "number" &&
          item.at > now - 730 * DAY &&
          item.at <= now,
      )
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, 200),
  );
}

function time(value: unknown, now: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.min(value, now)
    : 0;
}

export const useBlogSuggestionStore = create<BlogState>()(
  persist(
    (set) => ({
      posts: [],
      checkedAt: 0,
      history: {},
      lastShownAt: 0,
      activeSlug: null,
      show: (slug) =>
        set((state) => {
          const now = Date.now();
          if (state.activeSlug || state.history[slug] || now - state.lastShownAt < COOLDOWN)
            return state;
          return {
            activeSlug: slug,
            lastShownAt: now,
            history: pruneBlogHistory(
              { ...state.history, [slug]: { status: "seen", at: now } },
              now,
            ),
          };
        }),
      finish: (slug, status) =>
        set((state) => ({
          activeSlug: state.activeSlug === slug ? null : state.activeSlug,
          history: pruneBlogHistory({ ...state.history, [slug]: { status, at: Date.now() } }),
        })),
    }),
    {
      name: STORAGE_KEY,
      partialize: ({ posts, checkedAt, history, lastShownAt }) => ({
        posts,
        checkedAt,
        history,
        lastShownAt,
      }),
      merge: (persisted, current) => {
        const saved = persisted as Partial<BlogState> | null;
        const now = Date.now();
        const site = siteUrl();
        return {
          ...current,
          posts: Array.isArray(saved?.posts)
            ? saved.posts
                .slice(0, MAX_POSTS)
                .map((post) => parsePost(post, site))
                .filter((post): post is BlogPost => Boolean(post?.suggest))
            : [],
          checkedAt: time(saved?.checkedAt, now),
          history: pruneBlogHistory(saved?.history, now),
          lastShownAt: time(saved?.lastShownAt, now),
        };
      },
    },
  ),
);

syncAcrossWindows(STORAGE_KEY, () => void useBlogSuggestionStore.persist.rehydrate());

let inflight = false;

async function readText(response: Response): Promise<string> {
  if (Number(response.headers.get("content-length")) > MAX_FEED_BYTES)
    throw new Error("Blog-Feed zu groß");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Leerer Blog-Feed");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let length = 0;
  let text = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_FEED_BYTES) throw new Error("Blog-Feed zu groß");
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return text + decoder.decode();
}

export async function refreshBlogFeed(signal?: AbortSignal): Promise<void> {
  const state = useBlogSuggestionStore.getState();
  const now = Date.now();
  if (
    inflight ||
    signal?.aborted ||
    !useSettingsStore.getState().blogSuggestions ||
    (typeof navigator !== "undefined" && navigator.onLine === false) ||
    now - state.lastShownAt < COOLDOWN ||
    now - state.checkedAt < FETCH_INTERVAL
  )
    return;
  inflight = true;
  const previous = state.checkedAt;
  useBlogSuggestionStore.setState({ checkedAt: now });
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort);
  const timer = setTimeout(abort, 8000);
  try {
    const response = await fetch(websiteUrl(FEED_PATH), {
      credentials: "omit",
      cache: "no-cache",
      referrerPolicy: "no-referrer",
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      if (response.status === 404 || response.status === 410)
        useBlogSuggestionStore.setState({ posts: [] });
      return;
    }
    let posts: BlogPost[] = [];
    try {
      posts = parseBlogFeed(JSON.parse(await readText(response)));
    } catch (error) {
      if (controller.signal.aborted) throw error;
    }
    useBlogSuggestionStore.setState({ posts });
  } catch {
    if (signal?.aborted) useBlogSuggestionStore.setState({ checkedAt: previous });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    inflight = false;
  }
}

export async function readBlogPost(post: BlogPost): Promise<void> {
  useBlogSuggestionStore.getState().finish(post.slug, "read");
  const url = articleUrl(post.url);
  if (url) await openUrl(url).catch(() => undefined);
}
