import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createSafeJsonStorage } from "@/lib/buffered-storage";
import { syncAcrossWindows } from "@/lib/window-sync";
import { onDiscoveryReset } from "../usage";

export const HOTSPOT_STORAGE_KEY = "l8db.discovery.hotspots";
export const MAX_DISMISSED_HOTSPOTS = 200;
const FEATURE_ID = /^[a-z0-9][a-z0-9._-]{0,79}$/i;

interface HotspotState {
  dismissed: string[];
  dismiss: (id: string) => void;
}

export function pruneDismissed(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(value.filter((id): id is string => typeof id === "string" && FEATURE_ID.test(id))),
  ].slice(-MAX_DISMISSED_HOTSPOTS);
}

export const useHotspotStore = create<HotspotState>()(
  persist(
    (set, get) => ({
      dismissed: [],
      dismiss: (id) => {
        if (!get().dismissed.includes(id))
          set({ dismissed: pruneDismissed([...get().dismissed, id]) });
      },
    }),
    {
      name: HOTSPOT_STORAGE_KEY,
      storage: createSafeJsonStorage(),
      version: 1,
      partialize: ({ dismissed }) => ({ dismissed }),
      merge: (persisted, current) => ({
        ...current,
        dismissed: pruneDismissed((persisted as { dismissed?: unknown } | undefined)?.dismissed),
      }),
    },
  ),
);

syncAcrossWindows(HOTSPOT_STORAGE_KEY, () => void useHotspotStore.persist.rehydrate());
onDiscoveryReset(() => useHotspotStore.setState({ dismissed: [] }));
