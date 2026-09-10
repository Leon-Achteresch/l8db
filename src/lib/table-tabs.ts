import { create } from "zustand";

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
}

export const useTableTabs = create<TableTabsState>()((set) => ({
  tabs: [],
  openTab: (tab) =>
    set((state) =>
      state.tabs.some((existing) => tabKey(existing) === tabKey(tab))
        ? state
        : { tabs: [...state.tabs, tab] },
    ),
  closeTab: (tab) =>
    set((state) => ({
      tabs: state.tabs.filter((existing) => tabKey(existing) !== tabKey(tab)),
    })),
}));
