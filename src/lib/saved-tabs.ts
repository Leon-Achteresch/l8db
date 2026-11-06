import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createSafeJsonStorage } from "@/lib/buffered-storage";
import { type SharedTab, sharedTabLabel, validSharedTab } from "@/lib/shared-tabs";
import { syncAcrossWindows } from "@/lib/window-sync";

export const SAVED_TABS_KEY = "l8db.saved-tabs";
export const SAVED_TABS_LIMIT = 200;
export const SAVED_TABS_BYTES = 1_500_000;

export interface SavedTab {
  id: string;
  name: string;
  tab: SharedTab;
  createdAt: number;
}

function withinBudget(entries: SavedTab[]): SavedTab[] {
  let bytes = 0;
  const kept: SavedTab[] = [];
  for (const entry of entries) {
    if (kept.length >= SAVED_TABS_LIMIT) break;
    bytes += JSON.stringify(entry).length;
    if (bytes > SAVED_TABS_BYTES) break;
    kept.push(entry);
  }
  return kept;
}

interface SavedTabsState {
  saved: SavedTab[];
  saveTab: (tab: SharedTab, name?: string) => SavedTab | null;
  removeTab: (id: string) => void;
}

export const useSavedTabsStore = create<SavedTabsState>()(
  persist(
    (set, get) => ({
      saved: [],
      saveTab: (tab, name) => {
        const entry: SavedTab = {
          id: crypto.randomUUID(),
          name: name?.trim() || sharedTabLabel(tab),
          tab,
          createdAt: Date.now(),
        };
        if (JSON.stringify(entry).length > SAVED_TABS_BYTES) return null;
        const previous = get().saved;
        const same = JSON.stringify(tab);
        set({
          saved: withinBudget([
            entry,
            ...previous.filter(
              (saved) => saved.name !== entry.name || JSON.stringify(saved.tab) !== same,
            ),
          ]),
        });
        if (!window.localStorage.getItem(SAVED_TABS_KEY)?.includes(entry.id)) {
          set({ saved: previous });
          return null;
        }
        return entry;
      },
      removeTab: (id) =>
        set((state) => ({ saved: state.saved.filter((entry) => entry.id !== id) })),
    }),
    {
      name: SAVED_TABS_KEY,
      storage: createSafeJsonStorage(),
      partialize: (state) => ({ saved: state.saved }),
      merge: (persisted, current) => {
        const saved = (persisted as Partial<SavedTabsState> | undefined)?.saved;
        return {
          ...current,
          saved: Array.isArray(saved)
            ? withinBudget(
                saved.filter(
                  (entry) =>
                    typeof entry?.id === "string" &&
                    typeof entry.name === "string" &&
                    validSharedTab(entry.tab),
                ),
              )
            : [],
        };
      },
    },
  ),
);

syncAcrossWindows(SAVED_TABS_KEY, () => void useSavedTabsStore.persist.rehydrate());
