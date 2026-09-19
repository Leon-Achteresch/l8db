import { create } from "zustand";
import { persist } from "zustand/middleware";
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
    { name: "l8db.table-column-prefs" },
  ),
);
