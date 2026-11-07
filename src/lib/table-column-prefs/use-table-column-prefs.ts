import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createSafeJsonStorage } from "@/lib/buffered-storage";
import { syncAcrossWindows } from "@/lib/window-sync";
import type { TableColumnPrefsState } from "./types";

export const useTableColumnPrefs = create<TableColumnPrefsState>()(
  persist(
    (set) => ({
      prefs: {},
      profiles: {},
      setPref: (key, pref) =>
        set((state) => ({
          prefs: { ...state.prefs, [key]: pref },
        })),
      resetPref: (key) =>
        set((state) => {
          const prefs = { ...state.prefs };
          delete prefs[key];
          return { prefs };
        }),
      setProfiles: (key, profiles) =>
        set((state) => ({
          profiles: { ...(state.profiles ?? {}), [key]: profiles },
        })),
    }),
    { name: "l8db.table-column-prefs", storage: createSafeJsonStorage() },
  ),
);

syncAcrossWindows("l8db.table-column-prefs", () => void useTableColumnPrefs.persist.rehydrate());
