import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useActiveConnection } from "@/lib/connections";

interface SidebarSearchState {
  searches: Record<string, string>;
  setSearch: (key: string, value: string) => void;
}

const useSidebarSearchStore = create<SidebarSearchState>()(
  persist(
    (set) => ({
      searches: {},
      setSearch: (key, value) =>
        set((state) => {
          const searches = { ...state.searches };
          if (value) searches[key] = value;
          else delete searches[key];
          return { searches };
        }),
    }),
    { name: "l8db.sidebar-search" },
  ),
);

export function useSidebarSearch(tab: string): [string, (value: string) => void] {
  const key = `${useActiveConnection()?.id ?? ""}:${tab}`;
  const value = useSidebarSearchStore((state) => state.searches[key] ?? "");
  const setSearch = useSidebarSearchStore((state) => state.setSearch);
  return [value, (next: string) => setSearch(key, next)];
}
