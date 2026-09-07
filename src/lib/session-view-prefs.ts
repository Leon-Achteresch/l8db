import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { SessionGrouping } from "@/lib/session-filters";

interface SessionViewPrefsState {
  grouping: SessionGrouping;
  collapsedGroups: string[];
  setGrouping: (grouping: SessionGrouping) => void;
  toggleGroup: (key: string) => void;
  setCollapsedGroups: (keys: string[]) => void;
}

export const useSessionViewPrefs = create<SessionViewPrefsState>()(
  persist(
    (set) => ({
      grouping: "none",
      collapsedGroups: [],
      setGrouping: (grouping) => set({ grouping, collapsedGroups: [] }),
      toggleGroup: (key) =>
        set((state) => ({
          collapsedGroups: state.collapsedGroups.includes(key)
            ? state.collapsedGroups.filter((k) => k !== key)
            : [...state.collapsedGroups, key],
        })),
      setCollapsedGroups: (collapsedGroups) => set({ collapsedGroups }),
    }),
    { name: "l8db.session-view" },
  ),
);
