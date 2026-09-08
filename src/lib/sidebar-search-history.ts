import { create } from "zustand";
import { persist } from "zustand/middleware";

const MAX_ENTRIES = 25;

interface SidebarSearchHistoryState {
  entries: string[];
  add: (query: string) => void;
  remove: (query: string) => void;
  clear: () => void;
}

export const useSidebarSearchHistory = create<SidebarSearchHistoryState>()(
  persist(
    (set) => ({
      entries: [],
      add: (query) =>
        set((state) => {
          const value = query.trim();
          if (value === "") return state;
          return { entries: [value, ...state.entries.filter((e) => e !== value)].slice(0, MAX_ENTRIES) };
        }),
      remove: (query) => set((state) => ({ entries: state.entries.filter((e) => e !== query) })),
      clear: () => set({ entries: [] }),
    }),
    { name: "l8db.sidebar-search-history" },
  ),
);
