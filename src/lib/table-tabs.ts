import { create } from "zustand";
import { persist } from "zustand/middleware";

export type TableTab = { kind: "table"; schema: string; table: string };
export type QueryTab = { kind: "query"; id: string; title: string; sql: string };
export type Tab = TableTab | QueryTab;

export function tabKey(tab: Tab): string {
  return tab.kind === "table"
    ? `table:${tab.schema}.${tab.table}`
    : `query:${tab.id}`;
}

interface TabsState {
  tabs: Tab[];
  queryCounter: number;
  openTab: (tab: Omit<TableTab, "kind">) => void;
  openQueryTab: () => string;
  closeTab: (key: string) => void;
  closeOtherTabs: (key: string) => void;
  closeTabsToRight: (key: string) => void;
  closeAllTabs: () => void;
  reorderTabs: (fromIndex: number, toIndex: number) => void;
  updateQuerySql: (id: string, sql: string) => void;
}

export const useTableTabs = create<TabsState>()(
  persist(
    (set, get) => ({
      tabs: [],
      queryCounter: 0,

      openTab: (tab) => {
        const tableTab: TableTab = { kind: "table", ...tab };
        const key = tabKey(tableTab);
        set((state) =>
          state.tabs.some((t) => tabKey(t) === key)
            ? state
            : { tabs: [...state.tabs, tableTab] },
        );
      },

      openQueryTab: () => {
        const counter = get().queryCounter + 1;
        const qt: QueryTab = {
          kind: "query",
          id: crypto.randomUUID(),
          title: `Query ${counter}`,
          sql: "",
        };
        set((state) => ({ tabs: [...state.tabs, qt], queryCounter: counter }));
        return qt.id;
      },

      closeTab: (key) =>
        set((state) => ({
          tabs: state.tabs.filter((t) => tabKey(t) !== key),
        })),

      closeOtherTabs: (key) =>
        set((state) => ({
          tabs: state.tabs.filter((t) => tabKey(t) === key),
        })),

      closeTabsToRight: (key) =>
        set((state) => {
          const index = state.tabs.findIndex((t) => tabKey(t) === key);
          return index === -1 ? state : { tabs: state.tabs.slice(0, index + 1) };
        }),

      closeAllTabs: () => set({ tabs: [] }),

      reorderTabs: (fromIndex, toIndex) =>
        set((state) => {
          const tabs = [...state.tabs];
          const [item] = tabs.splice(fromIndex, 1);
          tabs.splice(toIndex, 0, item);
          return { tabs };
        }),

      updateQuerySql: (id, sql) =>
        set((state) => ({
          tabs: state.tabs.map((t) =>
            t.kind === "query" && t.id === id ? { ...t, sql } : t,
          ),
        })),
    }),
    {
      name: "l8db.table-tabs",
      version: 1,
      migrate: (persistedState: unknown, version: number) => {
        if (version === 0) {
          const old = persistedState as { tabs: { schema: string; table: string }[] };
          return {
            tabs: (old.tabs ?? []).map((t) => ({ kind: "table" as const, ...t })),
            queryCounter: 0,
          };
        }
        return persistedState;
      },
      partialize: (state) => ({ tabs: state.tabs, queryCounter: state.queryCounter }),
    },
  ),
);
