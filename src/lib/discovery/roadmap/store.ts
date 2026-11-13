import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createSafeJsonStorage } from "@/lib/buffered-storage";
import { syncAcrossWindows } from "@/lib/window-sync";
import {
  parseRoadmap,
  parseRoadmapRelease,
  ROADMAP_CACHE_MS,
  ROADMAP_INTERVAL_MS,
  ROADMAP_MANUAL_MS,
  ROADMAP_MAX_BYTES,
  ROADMAP_TIMEOUT_MS,
  ROADMAP_URL,
  type RoadmapFeed,
} from "./model";

export const ROADMAP_STORAGE_KEY = "l8db.discovery.roadmap";

export type RoadmapError = "offline" | "rate-limit" | "missing" | "failed";

interface RoadmapState {
  feed: RoadmapFeed | null;
  fetchedAt: number;
  checkedAt: number;
  loading: boolean;
  error: RoadmapError | null;
}

export const useRoadmapStore = create<RoadmapState>()(
  persist(
    (): RoadmapState => ({ feed: null, fetchedAt: 0, checkedAt: 0, loading: false, error: null }),
    {
      name: ROADMAP_STORAGE_KEY,
      storage: createSafeJsonStorage(),
      version: 1,
      partialize: ({ feed, fetchedAt, checkedAt }) => ({ feed, fetchedAt, checkedAt }),
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<RoadmapState>;
        const now = Date.now();
        const fetchedAt =
          typeof saved.fetchedAt === "number" && saved.fetchedAt <= now ? saved.fetchedAt : 0;
        const checkedAt =
          typeof saved.checkedAt === "number" && saved.checkedAt <= now ? saved.checkedAt : 0;
        let feed: RoadmapFeed | null = null;
        try {
          feed = saved.feed && now - fetchedAt < ROADMAP_CACHE_MS ? parseRoadmap(saved.feed) : null;
        } catch {
          feed = null;
        }
        return { ...current, feed, fetchedAt: feed ? fetchedAt : 0, checkedAt };
      },
    },
  ),
);

syncAcrossWindows(ROADMAP_STORAGE_KEY, () => void useRoadmapStore.persist.rehydrate());

export function cachedRoadmap(now = Date.now()): RoadmapFeed | null {
  const { feed, fetchedAt } = useRoadmapStore.getState();
  return feed && now - fetchedAt < ROADMAP_CACHE_MS ? feed : null;
}

export function nextManualRefresh(now = Date.now()): number {
  return Math.max(0, useRoadmapStore.getState().checkedAt + ROADMAP_MANUAL_MS - now);
}

async function readLimited(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Leerer Roadmap-Feed");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > ROADMAP_MAX_BYTES * 2) throw new Error("Roadmap-Feed zu groß");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function rateLimited(response: Response): boolean {
  return (
    response.status === 429 ||
    (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0")
  );
}

export async function refreshRoadmap(force = false): Promise<boolean> {
  const state = useRoadmapStore.getState();
  const now = Date.now();
  const wait = force ? ROADMAP_MANUAL_MS : ROADMAP_INTERVAL_MS;
  if (state.loading || now - state.checkedAt < wait) return false;
  useRoadmapStore.setState({ loading: true, checkedAt: now, error: null });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ROADMAP_TIMEOUT_MS);
  try {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      useRoadmapStore.setState({ error: "offline" });
      return true;
    }
    const response = await fetch(ROADMAP_URL, {
      credentials: "omit",
      cache: "no-cache",
      signal: controller.signal,
      headers: { Accept: "application/vnd.github+json" },
    });
    if (response.status === 404) {
      useRoadmapStore.setState({ feed: null, fetchedAt: 0, error: "missing" });
      return true;
    }
    if (rateLimited(response)) {
      useRoadmapStore.setState({ error: "rate-limit" });
      return true;
    }
    if (!response.ok) throw new Error("Roadmap nicht erreichbar");
    const feed = parseRoadmapRelease(await readLimited(response));
    useRoadmapStore.setState({ feed, fetchedAt: Date.now() });
  } catch {
    useRoadmapStore.setState({
      error: typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "failed",
    });
  } finally {
    clearTimeout(timeout);
    useRoadmapStore.setState({ loading: false, feed: cachedRoadmap() });
  }
  return true;
}
