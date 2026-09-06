import { create } from "zustand";
import { persist } from "zustand/middleware";

import { useConnectionsStore } from "@/lib/connections";

export type TableTab = {
  kind: "table";
  schema: string;
  table: string;
  entityType?: "table" | "view";
};
export type QueryTab = {
  kind: "query";
  id: string;
  title: string;
  sql: string;
  filePath?: string;
  savedSql?: string;
  fileMtime?: number | null;
  externalChange?: boolean;
};
export type QueryFileInfo = { path: string; mtime: number | null };

export function isQueryTabDirty(tab: QueryTab): boolean {
  return tab.filePath !== undefined && tab.sql !== (tab.savedSql ?? "");
}
export type FunctionTab = { kind: "function"; schema: string; name: string; oid: string };
export type ExtensionTab = { kind: "extension"; name: string };
export type RoleTab = { kind: "role"; name: string };
export type TriggerTab = { kind: "trigger"; schema: string; table: string; trigger: string };
export type ViewEditorTab = { kind: "view-editor"; schema: string; view: string };
export type AlterTableTab = { kind: "alter-table"; schema: string; table: string };
export type PackageTab = { kind: "package"; schema: string; name: string };
export type Tab =
  | TableTab
  | QueryTab
  | FunctionTab
  | ExtensionTab
  | RoleTab
  | TriggerTab
  | ViewEditorTab
  | AlterTableTab
  | PackageTab;

export function tabKey(tab: Tab): string {
  if (tab.kind === "table") return `table:${tab.schema}.${tab.table}`;
  if (tab.kind === "query") return `query:${tab.id}`;
  if (tab.kind === "function") return `function:${tab.oid}`;
  if (tab.kind === "role") return `role:${tab.name}`;
  if (tab.kind === "trigger") return `trigger:${tab.schema}.${tab.table}.${tab.trigger}`;
  if (tab.kind === "view-editor") return `view-editor:${tab.schema}.${tab.view}`;
  if (tab.kind === "alter-table") return `alter-table:${tab.schema}.${tab.table}`;
  if (tab.kind === "package") return `package:${tab.schema}.${tab.name}`;
  return `extension:${tab.name}`;
}

const NONE_KEY = "__none__";

function keyForConnection(id: string | null | undefined): string {
  return id ?? NONE_KEY;
}

function readPersistedActiveConnectionId(): string | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    const raw = window.localStorage.getItem("l8db.connections");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { state?: { activeId?: string | null } };
    return parsed?.state?.activeId ?? null;
  } catch {
    return null;
  }
}

interface TabsState {
  tabs: Tab[];
  tabsByConnection: Record<string, Tab[]>;
  queryCounter: number;
  openTab: (tab: Omit<TableTab, "kind">) => void;
  openQueryTab: () => string;
  openQueryTabWithSql: (sql: string, title?: string) => string;
  openSavedQueryTab: (tab: { id: string; title: string; sql: string }) => void;
  openFunctionTab: (tab: Omit<FunctionTab, "kind">) => void;
  openExtensionTab: (tab: Omit<ExtensionTab, "kind">) => void;
  openRoleTab: (tab: Omit<RoleTab, "kind">) => void;
  openTriggerTab: (tab: Omit<TriggerTab, "kind">) => void;
  openViewEditorTab: (tab: Omit<ViewEditorTab, "kind">) => void;
  openAlterTableTab: (tab: Omit<AlterTableTab, "kind">) => void;
  openPackageTab: (tab: Omit<PackageTab, "kind">) => void;
  closeTab: (key: string) => void;
  closeOtherTabs: (key: string) => void;
  closeTabsToRight: (key: string) => void;
  closeAllTabs: () => void;
  clearTabsForConnection: (connectionId: string) => void;
  reorderTabs: (fromIndex: number, toIndex: number) => void;
  updateQuerySql: (id: string, sql: string) => void;
  openFileQueryTab: (file: QueryFileInfo & { sql: string; title: string }) => string;
  bindQueryTabFile: (id: string, file: QueryFileInfo & { title: string }) => void;
  markQueryTabSaved: (id: string, mtime: number | null) => void;
  setQueryTabExternalChange: (id: string, changed: boolean, mtime?: number | null) => void;
  reloadQueryTabFromFile: (id: string, sql: string, mtime: number | null) => void;
}

function patchQueryTab(tabs: Tab[], id: string, patch: Partial<QueryTab>): Tab[] {
  return tabs.map((t) => (t.kind === "query" && t.id === id ? { ...t, ...patch } : t));
}

function storeFor(
  tabs: Tab[],
  state: { tabsByConnection: Record<string, Tab[]> },
): Pick<TabsState, "tabs" | "tabsByConnection"> {
  return {
    tabs,
    tabsByConnection: {
      ...state.tabsByConnection,
      [keyForConnection(useConnectionsStore.getState().activeId)]: tabs,
    },
  };
}

export const useTableTabs = create<TabsState>()(
  persist(
    (set, get) => ({
      tabs: [],
      tabsByConnection: {},
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
            return storeFor([...state.tabs, tableTab], state);
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
          return storeFor(tabs, state);
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
        set((state) => ({ ...storeFor([...state.tabs, qt], state), queryCounter: counter }));
        return qt.id;
      },

      openQueryTabWithSql: (sql, title) => {
        const counter = get().queryCounter + 1;
        const qt: QueryTab = {
          kind: "query",
          id: crypto.randomUUID(),
          title: title ?? `Query ${counter}`,
          sql,
        };
        set((state) => ({ ...storeFor([...state.tabs, qt], state), queryCounter: counter }));
        return qt.id;
      },

      openSavedQueryTab: (tab) => {
        set((state) => {
          if (state.tabs.some((t) => t.kind === "query" && t.id === tab.id)) return state;
          return storeFor([...state.tabs, { kind: "query", ...tab }], state);
        });
      },

      openFunctionTab: (tab) => {
        const ft: FunctionTab = { kind: "function", ...tab };
        const key = tabKey(ft);
        set((state) => {
          if (state.tabs.some((t) => tabKey(t) === key)) return state;
          return storeFor([...state.tabs, ft], state);
        });
      },

      openExtensionTab: (tab) => {
        const et: ExtensionTab = { kind: "extension", ...tab };
        const key = tabKey(et);
        set((state) => {
          if (state.tabs.some((t) => tabKey(t) === key)) return state;
          return storeFor([...state.tabs, et], state);
        });
      },

      openPackageTab: (tab) => {
        const pt: PackageTab = { kind: "package", ...tab };
        const key = tabKey(pt);
        set((state) => {
          if (state.tabs.some((t) => tabKey(t) === key)) return state;
          return storeFor([...state.tabs, pt], state);
        });
      },

      openRoleTab: (tab) => {
        const rt: RoleTab = { kind: "role", ...tab };
        const key = tabKey(rt);
        set((state) => {
          if (state.tabs.some((t) => tabKey(t) === key)) return state;
          return storeFor([...state.tabs, rt], state);
        });
      },

      openTriggerTab: (tab) => {
        const tt: TriggerTab = { kind: "trigger", ...tab };
        const key = tabKey(tt);
        set((state) => {
          if (state.tabs.some((t) => tabKey(t) === key)) return state;
          return storeFor([...state.tabs, tt], state);
        });
      },

      openViewEditorTab: (tab) => {
        const vt: ViewEditorTab = { kind: "view-editor", ...tab };
        const key = tabKey(vt);
        set((state) => {
          if (state.tabs.some((t) => tabKey(t) === key)) return state;
          return storeFor([...state.tabs, vt], state);
        });
      },

      openAlterTableTab: (tab) => {
        const at: AlterTableTab = { kind: "alter-table", ...tab };
        const key = tabKey(at);
        set((state) => {
          if (state.tabs.some((t) => tabKey(t) === key)) return state;
          return storeFor([...state.tabs, at], state);
        });
      },

      closeTab: (key) =>
        set((state) =>
          storeFor(
            state.tabs.filter((t) => tabKey(t) !== key),
            state,
          ),
        ),

      closeOtherTabs: (key) =>
        set((state) =>
          storeFor(
            state.tabs.filter((t) => tabKey(t) === key),
            state,
          ),
        ),

      closeTabsToRight: (key) =>
        set((state) => {
          const index = state.tabs.findIndex((t) => tabKey(t) === key);
          return index === -1 ? state : storeFor(state.tabs.slice(0, index + 1), state);
        }),

      closeAllTabs: () => set((state) => storeFor([], state)),

      clearTabsForConnection: (connectionId) =>
        set((state) => {
          if (state.tabsByConnection[connectionId] === undefined) {
            if (
              keyForConnection(useConnectionsStore.getState().activeId) !== connectionId ||
              state.tabs.length === 0
            ) {
              return state;
            }
            return { tabs: [] };
          }
          const tabsByConnection = { ...state.tabsByConnection };
          delete tabsByConnection[connectionId];
          if (keyForConnection(useConnectionsStore.getState().activeId) === connectionId) {
            return { tabs: [], tabsByConnection };
          }
          return { tabsByConnection };
        }),

      reorderTabs: (fromIndex, toIndex) =>
        set((state) => {
          const tabs = [...state.tabs];
          const [item] = tabs.splice(fromIndex, 1);
          tabs.splice(toIndex, 0, item);
          return storeFor(tabs, state);
        }),

      updateQuerySql: (id, sql) =>
        set((state) => storeFor(patchQueryTab(state.tabs, id, { sql }), state)),

      openFileQueryTab: (file) => {
        const existing = get().tabs.find((t) => t.kind === "query" && t.filePath === file.path);
        if (existing && existing.kind === "query") return existing.id;
        const qt: QueryTab = {
          kind: "query",
          id: crypto.randomUUID(),
          title: file.title,
          sql: file.sql,
          filePath: file.path,
          savedSql: file.sql,
          fileMtime: file.mtime,
          externalChange: false,
        };
        set((state) => storeFor([...state.tabs, qt], state));
        return qt.id;
      },

      bindQueryTabFile: (id, file) =>
        set((state) => {
          const tab = state.tabs.find((t) => t.kind === "query" && t.id === id);
          if (!tab || tab.kind !== "query") return state;
          return storeFor(
            patchQueryTab(state.tabs, id, {
              filePath: file.path,
              title: file.title,
              savedSql: tab.sql,
              fileMtime: file.mtime,
              externalChange: false,
            }),
            state,
          );
        }),

      markQueryTabSaved: (id, mtime) =>
        set((state) => {
          const tab = state.tabs.find((t) => t.kind === "query" && t.id === id);
          if (!tab || tab.kind !== "query") return state;
          return storeFor(
            patchQueryTab(state.tabs, id, {
              savedSql: tab.sql,
              fileMtime: mtime,
              externalChange: false,
            }),
            state,
          );
        }),

      setQueryTabExternalChange: (id, changed, mtime) =>
        set((state) =>
          storeFor(
            patchQueryTab(state.tabs, id, {
              externalChange: changed,
              ...(mtime === undefined ? {} : { fileMtime: mtime }),
            }),
            state,
          ),
        ),

      reloadQueryTabFromFile: (id, sql, mtime) =>
        set((state) =>
          storeFor(
            patchQueryTab(state.tabs, id, {
              sql,
              savedSql: sql,
              fileMtime: mtime,
              externalChange: false,
            }),
            state,
          ),
        ),
    }),
    {
      name: "l8db.table-tabs",
      version: 3,
      migrate: (persistedState: unknown, version: number) => {
        if (version === 0) {
          const old = persistedState as { tabs: { schema: string; table: string }[] };
          const tabs: Tab[] = (old.tabs ?? []).map((t) => ({
            kind: "table" as const,
            ...t,
            entityType: "table" as const,
          }));
          const activeId = readPersistedActiveConnectionId();
          return {
            tabs,
            tabsByConnection: activeId ? { [activeId]: tabs } : {},
            queryCounter: 0,
          };
        }
        if (version === 1) {
          const old = persistedState as { tabs: TableTab[]; queryCounter: number };
          const tabs: Tab[] = (old.tabs ?? []).map((t) =>
            t.kind === "table" ? { ...t, entityType: t.entityType ?? "table" } : t,
          );
          const activeId = readPersistedActiveConnectionId();
          return {
            tabs,
            tabsByConnection: activeId ? { [activeId]: tabs } : {},
            queryCounter: old.queryCounter ?? 0,
          };
        }
        if (version === 2) {
          const old = persistedState as { tabs: Tab[]; queryCounter: number };
          const tabs = old.tabs ?? [];
          const activeId = readPersistedActiveConnectionId();
          return {
            tabs,
            tabsByConnection: activeId ? { [activeId]: tabs } : {},
            queryCounter: old.queryCounter ?? 0,
          };
        }
        return persistedState;
      },
      partialize: (state) => ({
        tabs: state.tabs,
        tabsByConnection: state.tabsByConnection,
        queryCounter: state.queryCounter,
      }),
      onRehydrateStorage: () => (rehydratedState) => {
        if (!rehydratedState) return;
        if (!useConnectionsStore.persist.hasHydrated()) return;
        const key = keyForConnection(useConnectionsStore.getState().activeId);
        const stored = rehydratedState.tabsByConnection[key];
        if (stored === undefined) {
          useTableTabs.setState({
            tabsByConnection: { ...rehydratedState.tabsByConnection, [key]: rehydratedState.tabs },
          });
        } else if (stored !== rehydratedState.tabs) {
          useTableTabs.setState({ tabs: stored });
        }
      },
    },
  ),
);

useConnectionsStore.subscribe((state, previous) => {
  const nextId = state.activeId;
  const previousId = previous.activeId;
  if (nextId === previousId) return;
  const tabsState = useTableTabs.getState();
  const nextKey = keyForConnection(nextId);
  if (!useConnectionsStore.persist.hasHydrated() || !useTableTabs.persist.hasHydrated()) {
    const stored = tabsState.tabsByConnection[nextKey];
    if (stored !== undefined && stored !== tabsState.tabs) {
      useTableTabs.setState({ tabs: stored });
    }
    return;
  }
  useTableTabs.setState({
    tabsByConnection: {
      ...tabsState.tabsByConnection,
      [keyForConnection(previousId)]: tabsState.tabs,
    },
    tabs: tabsState.tabsByConnection[nextKey] ?? [],
  });
});
