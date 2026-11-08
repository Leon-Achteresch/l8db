import valid from "semver/functions/valid";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createSafeJsonStorage } from "@/lib/buffered-storage";
import { syncAcrossWindows } from "@/lib/window-sync";
import { onDiscoveryReset } from "../usage";
import type { SpotlightContent } from "./model";

export const SPOTLIGHT_STORAGE_KEY = "l8db.discovery.spotlight";
export const SPOTLIGHT_SURFACE_ID = "release";

interface SpotlightState {
  seenVersion: string | null;
  lastActive: number | null;
  previousActive: number | null | undefined;
  open: SpotlightContent | null;
  explicit: boolean;
  sessionShown: boolean;
  markSeen: (version: string) => void;
  touch: (now?: number) => void;
  show: (content: SpotlightContent, explicit: boolean) => void;
  close: () => void;
}

export function sameDay(a: number, b: number): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

export const useSpotlightStore = create<SpotlightState>()(
  persist(
    (set, get) => ({
      seenVersion: null,
      lastActive: null,
      previousActive: undefined,
      open: null,
      explicit: false,
      sessionShown: false,
      markSeen: (version) => {
        if (get().seenVersion !== version) set({ seenVersion: version });
      },
      touch: (now = Date.now()) => {
        const { lastActive, previousActive } = get();
        if (previousActive === undefined) set({ previousActive: lastActive });
        if (lastActive === null || !sameDay(lastActive, now)) set({ lastActive: now });
      },
      show: (open, explicit) =>
        set((state) => ({ open, explicit, sessionShown: state.sessionShown || !explicit })),
      close: () => set({ open: null, explicit: false }),
    }),
    {
      name: SPOTLIGHT_STORAGE_KEY,
      storage: createSafeJsonStorage(),
      version: 1,
      partialize: ({ seenVersion, lastActive }) => ({ seenVersion, lastActive }),
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as { seenVersion?: unknown; lastActive?: unknown };
        return {
          ...current,
          seenVersion:
            typeof saved.seenVersion === "string" && valid(saved.seenVersion)
              ? saved.seenVersion
              : null,
          lastActive:
            typeof saved.lastActive === "number" && Number.isFinite(saved.lastActive)
              ? saved.lastActive
              : null,
        };
      },
    },
  ),
);

syncAcrossWindows(SPOTLIGHT_STORAGE_KEY, () => void useSpotlightStore.persist.rehydrate());
onDiscoveryReset(() => useSpotlightStore.setState({ seenVersion: null, lastActive: null }));

export function refreshSeenVersion(): string | null {
  void useSpotlightStore.persist.rehydrate();
  return useSpotlightStore.getState().seenVersion;
}

export async function openSpotlight(): Promise<boolean> {
  const [{ FEATURE_CATALOG }, { manualSpotlightContent }, { requestSurface }] = await Promise.all([
    import("../catalog"),
    import("./model"),
    import("../coordinator"),
  ]);
  const content = manualSpotlightContent(FEATURE_CATALOG);
  if (!content) return false;
  requestSurface({ channel: "spotlight", id: SPOTLIGHT_SURFACE_ID, priority: 90, explicit: true });
  useSpotlightStore.getState().show(content, true);
  return true;
}
