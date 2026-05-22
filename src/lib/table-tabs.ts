import { create } from "zustand";
import { persist } from "zustand/middleware";

export type TableTab = {
  kind: "table";
  schema: string;
  table: string;
  entityType?: "table" | "view";
};
export type QueryTab = { kind: "query"; id: string; title: string; sql: string };
export type FunctionTab = { kind: "function"; schema: string; name: string; oid: string };
export type ExtensionTab = { kind: "extension"; name: string };
export type Tab = TableTab | QueryTab | FunctionTab | ExtensionTab;

export function tabKey(tab: Tab): string {
  if (tab.kind === "table") return `table:${tab.schema}.${tab.table}`;
  if (tab.kind === "query") return `query:${tab.id}`;
  if (tab.kind === "function") return `function:${tab.oid}`;
  return `extension:${tab.name}`;
}

interface TabsState {
  tabs: Tab[];
  queryCounter: number;
  openTab: (tab: Omit<TableTab, "kind">) => void;
  openQueryTab: () => string;
  openFunctionTab: (tab: Omit<FunctionTab, "kind">) => void;
  openExtensionTab: (tab: Omit<ExtensionTab, "kind">) => void;
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
        const tableTab: TableTab = {
          kind: "table",
          schema: tab.schema,
          table: tab.table,
          entityType: tab.entityType ?? "table",
        };
        const key = tabKey(tableTab);
        set((state) => {
          const index = state.tabs.findIndex((t) => tabKey(t) === key);
          if (index === -1) {
            return { tabs: [...state.tabs, tableTab] };
          }
          const existing = state.tabs[index];
          if (
            existing.kind === "table" &&
            (existing.entityType ?? "table") === tableTab.entityType
          ) {
            return state;
          }
          const tabs = [...state.tabs];
          tabs[index] = tableTab;
          return { tabs };
        });
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

      openFunctionTab: (tab) => {
        const ft: FunctionTab = { kind: "function", ...tab };
        const key = tabKey(ft);
        set((state) => {
          if (state.tabs.some((t) => tabKey(t) === key)) return state;
          return { tabs: [...state.tabs, ft] };
        });
      },

      openExtensionTab: (tab) => {
        const et: ExtensionTab = { kind: "extension", ...tab };
        const key = tabKey(et);
        set((state) => {
          if (state.tabs.some((t) => tabKey(t) === key)) return state;
          return { tabs: [...state.tabs, et] };
        });
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
      version: 2,
      migrate: (persistedState: unknown, version: number) => {
        if (version === 0) {
          const old = persistedState as { tabs: { schema: string; table: string }[] };
          return {
            tabs: (old.tabs ?? []).map((t) => ({
              kind: "table" as const,
              ...t,
              entityType: "table" as const,
            })),
            queryCounter: 0,
          };
        }
        if (version === 1) {
          const old = persistedState as { tabs: TableTab[]; queryCounter: number };
          return {
            tabs: (old.tabs ?? []).map((t) =>
              t.kind === "table" ? { ...t, entityType: t.entityType ?? "table" } : t,
            ),
            queryCounter: old.queryCounter ?? 0,
          };
        }
        return persistedState;
      },
      partialize: (state) => ({ tabs: state.tabs, queryCounter: state.queryCounter }),
    },
  ),
);
