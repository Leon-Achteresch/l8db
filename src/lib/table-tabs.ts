import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface TableTab {
  schema: string;
  table: string;
}

export function tabKey(tab: TableTab): string {
  return `${tab.schema}.${tab.table}`;
}

interface TableTabsState {
  tabs: TableTab[];
  openTab: (tab: TableTab) => void;
  closeTab: (tab: TableTab) => void;
  closeOtherTabs: (tab: TableTab) => void;
  closeTabsToRight: (tab: TableTab) => void;
  closeAllTabs: () => void;
  reorderTabs: (fromIndex: number, toIndex: number) => void;
}

export const useTableTabs = create<TableTabsState>()(
  persist(
    (set) => ({
      tabs: [],
      openTab: (tab) =>
        set((state) =>
          state.tabs.some((existing) => tabKey(existing) === tabKey(tab))
            ? state
            : { tabs: [...state.tabs, tab] },
        ),
      closeTab: (tab) =>
        set((state) => ({
          tabs: state.tabs.filter(
            (existing) => tabKey(existing) !== tabKey(tab),
          ),
        })),
      closeOtherTabs: (tab) =>
        set((state) => ({
          tabs: state.tabs.filter(
            (existing) => tabKey(existing) === tabKey(tab),
          ),
        })),
      closeTabsToRight: (tab) =>
        set((state) => {
          const index = state.tabs.findIndex(
            (existing) => tabKey(existing) === tabKey(tab),
          );
          return index === -1
            ? state
            : { tabs: state.tabs.slice(0, index + 1) };
        }),
      closeAllTabs: () => set({ tabs: [] }),
      reorderTabs: (fromIndex, toIndex) =>
        set((state) => {
          const tabs = [...state.tabs];
          const [item] = tabs.splice(fromIndex, 1);
          tabs.splice(toIndex, 0, item);
          return { tabs };
        }),
    }),
    {
      name: "l8db.table-tabs",
      partialize: (state) => ({ tabs: state.tabs }),
    },
  ),
);
