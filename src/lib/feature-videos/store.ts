import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DAY, FEED_URL, type FeatureVideoFeed, parseFeed } from "./model";

type History = Record<string, { status: "offered" | "seen" | "dismissed"; at: number }>;
interface VideoState {
  feed: FeatureVideoFeed | null;
  checkedAt: number;
  history: History;
  activeId: string | null;
  manual: boolean;
  sessionUsed: boolean;
  loading: boolean;
  error: boolean;
  open: (id: string, manual?: boolean) => void;
  close: () => void;
  mark: (id: string, status: History[string]["status"]) => void;
}

export function pruneHistory(value: unknown, now = Date.now()): History {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([id, item]) =>
          /^[a-z0-9-]{1,64}$/.test(id) &&
          item &&
          typeof item === "object" &&
          ["offered", "seen", "dismissed"].includes(item.status) &&
          typeof item.at === "number" &&
          item.at > now - 120 * DAY &&
          item.at <= now,
      )
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, 100),
  );
}

export const useFeatureVideoStore = create<VideoState>()(
  persist(
    (set) => ({
      feed: null,
      checkedAt: 0,
      history: {},
      activeId: null,
      manual: false,
      sessionUsed: false,
      loading: false,
      error: false,
      open: (activeId, manual = false) => set({ activeId, manual, sessionUsed: true }),
      close: () => set({ activeId: null }),
      mark: (id, status) =>
        set((state) => ({
          history: pruneHistory({ ...state.history, [id]: { status, at: Date.now() } }),
        })),
    }),
    {
      name: "l8db.feature-videos",
      partialize: ({ feed, checkedAt, history }) => ({ feed, checkedAt, history }),
      merge: (persisted, current) => {
        const saved = persisted as Partial<VideoState> | null;
        let feed: FeatureVideoFeed | null = null;
        try {
          feed = parseFeed(saved?.feed);
        } catch {
          feed = null;
        }
        return {
          ...current,
          feed,
          history: pruneHistory(saved?.history),
          checkedAt:
            typeof saved?.checkedAt === "number" && saved.checkedAt <= Date.now()
              ? saved.checkedAt
              : 0,
        };
      },
    },
  ),
);

export async function refreshFeatureVideos(force = false): Promise<void> {
  const state = useFeatureVideoStore.getState();
  if (state.loading || Date.now() - state.checkedAt < (force ? 60_000 : 6 * 60 * 60 * 1000)) return;
  useFeatureVideoStore.setState({ loading: true, checkedAt: Date.now(), error: false });
  try {
    const response = await fetch(FEED_URL, {
      credentials: "omit",
      cache: "no-cache",
      signal: AbortSignal.timeout(8000),
      headers: { Accept: "application/vnd.github+json" },
    });
    if (response.status === 404) {
      useFeatureVideoStore.setState({ feed: null });
      return;
    }
    if (!response.ok) throw new Error("Feature-Videos sind nicht erreichbar");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Leerer Feature-Feed");
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > 200_000) throw new Error("Feature-Feed zu groß");
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
    const raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const release = JSON.parse(raw);
    if (release.draft || release.tag_name !== "feature-videos" || typeof release.body !== "string")
      throw new Error("Ungültiger Medien-Release");
    const feed = parseFeed(JSON.parse(release.body));
    useFeatureVideoStore.setState({ feed });
  } catch {
    const cached = useFeatureVideoStore.getState().feed;
    useFeatureVideoStore.setState({
      error: true,
      feed: cached && Date.parse(cached.validUntil) > Date.now() ? cached : null,
    });
  } finally {
    useFeatureVideoStore.setState({ loading: false });
  }
}
