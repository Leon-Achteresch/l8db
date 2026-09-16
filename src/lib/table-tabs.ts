import { create } from "zustand";
import { persist } from "zustand/middleware";

import { createBufferedJsonStorage } from "@/lib/buffered-storage";
import { useConnectionsStore } from "@/lib/connections";
import { databaseFromConnectionString, useDbSelectionStore } from "@/lib/db-selection";
import type { ToolId } from "@/lib/tool-tabs";

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
  lastExecutedSql?: string;
  filePath?: string;
  savedSql?: string;
  fileMtime?: number | null;
  externalChange?: boolean;
  bookmarks?: number[];
  bookmarkSlots?: BookmarkSlots;
  autoRun?: boolean;
};
export type QueryFileInfo = { path: string; mtime: number | null; savedSql?: string };

export function isQueryTabDirty(tab: QueryTab): boolean {
  return tab.filePath !== undefined && tab.sql !== (tab.savedSql ?? "");
}

export function queryNeedsCloseConfirmation(tab: QueryTab): boolean {
  return isQueryTabDirty(tab) || (!tab.filePath && tab.sql.trim().length > 0);
}

export function hasUnexecutedQueryChanges(tab: QueryTab): boolean {
  return (
    tab.sql.trim().length > 0 &&
    tab.lastExecutedSql !== undefined &&
    tab.sql !== tab.lastExecutedSql
  );
}
export type FunctionTab = { kind: "function"; schema: string; name: string; oid: string };
export type ProcedureTab = { kind: "procedure"; schema: string; name: string; oid: string };
export type ExtensionTab = { kind: "extension"; name: string };
export type ExtensionPanelTab = {
  kind: "extension-panel";
  extensionId: string;
  panelId: string;
  title: string;
};
export type RoleTab = { kind: "role"; name: string };
export type TriggerTab = { kind: "trigger"; schema: string; table: string; trigger: string };
export type ViewEditorTab = { kind: "view-editor"; schema: string; view: string };
export type AlterTableTab = { kind: "alter-table"; schema: string; table: string };
export type PackageTab = { kind: "package"; schema: string; name: string };
export type ToolTab = { kind: "tool"; tool: ToolId };
export type Tab =
  | TableTab
  | QueryTab
  | FunctionTab
  | ProcedureTab
  | ExtensionTab
  | ExtensionPanelTab
  | RoleTab
  | TriggerTab
  | ViewEditorTab
  | AlterTableTab
  | PackageTab
  | ToolTab;

export function tabKey(tab: Tab): string {
  if (tab.kind === "table") return `table:${tab.schema}.${tab.table}`;
  if (tab.kind === "query") return `query:${tab.id}`;
  if (tab.kind === "function") return `function:${tab.oid}`;
  if (tab.kind === "procedure") return `procedure:${tab.oid}`;
  if (tab.kind === "role") return `role:${tab.name}`;
  if (tab.kind === "trigger") return `trigger:${tab.schema}.${tab.table}.${tab.trigger}`;
  if (tab.kind === "view-editor") return `view-editor:${tab.schema}.${tab.view}`;
  if (tab.kind === "alter-table") return `alter-table:${tab.schema}.${tab.table}`;
  if (tab.kind === "package") return `package:${tab.schema}.${tab.name}`;
  if (tab.kind === "tool") return `tool:${tab.tool}`;
  if (tab.kind === "extension-panel") return `extension-panel:${tab.extensionId}:${tab.panelId}`;
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

export type ClosedTab = Tab & {
  recoveryId?: string;
  closedAt?: number;
  closedConnectionId?: string | null;
  closedConnectionName?: string;
  closedDatabase?: string | null;
};

interface TabsState {
  tabs: Tab[];
  tabsByConnection: Record<string, Tab[]>;
  recentlyClosed: ClosedTab[];
  openTab: (tab: Omit<TableTab, "kind">) => void;
  openQueryTab: () => string;
  openQueryTabWithSql: (sql: string, title?: string, autoRun?: boolean) => string;
  openSavedQueryTab: (tab: { id: string; title: string; sql: string }) => void;
  openFunctionTab: (tab: Omit<FunctionTab, "kind">) => void;
  openProcedureTab: (tab: Omit<ProcedureTab, "kind">) => void;
  openExtensionTab: (tab: Omit<ExtensionTab, "kind">) => void;
  openExtensionPanel: (tab: Omit<ExtensionPanelTab, "kind">) => void;
  openRoleTab: (tab: Omit<RoleTab, "kind">) => void;
  openTriggerTab: (tab: Omit<TriggerTab, "kind">) => void;
  openViewEditorTab: (tab: Omit<ViewEditorTab, "kind">) => void;
  openAlterTableTab: (tab: Omit<AlterTableTab, "kind">) => void;
  openPackageTab: (tab: Omit<PackageTab, "kind">) => void;
  openToolTab: (tool: ToolId) => void;
  closeTab: (key: string) => void;
  closeOtherTabs: (key: string) => void;
  closeTabsToRight: (key: string) => void;
  closeAllTabs: () => void;
  reopenLastTab: () => Tab | null;
  reopenClosedTab: (id: string) => Tab | null;
  forgetClosedTab: (id: string) => void;
  clearTabsForConnection: (connectionId: string) => void;
  reorderTabs: (fromIndex: number, toIndex: number) => void;
  updateQuerySql: (id: string, sql: string) => void;
  markQueryTabExecuted: (id: string, sql: string) => void;
  openFileQueryTab: (file: QueryFileInfo & { sql: string; title: string }) => string;
  bindQueryTabFile: (id: string, file: QueryFileInfo & { title: string }) => void;
  markQueryTabSaved: (id: string, mtime: number | null, savedSql?: string) => void;
  setQueryTabExternalChange: (id: string, changed: boolean, mtime?: number | null) => void;
  reloadQueryTabFromFile: (id: string, sql: string, mtime: number | null) => void;
  toggleQueryBookmark: (id: string, line: number) => void;
  setQueryBookmarks: (id: string, lines: number[]) => void;
  setQueryBookmarkSlot: (id: string, slot: number, line: number | null) => void;
  clearQueryBookmarks: (id: string) => void;
}

export function normalizeBookmarks(lines: number[]): number[] {
  return [...new Set(lines.filter((line) => Number.isInteger(line) && line > 0))].sort(
    (a, b) => a - b,
  );
}

export function queryTabBookmarks(tab: QueryTab): number[] {
  return normalizeBookmarks(tab.bookmarks ?? []);
}

export type BookmarkSlots = Record<string, number>;

export function normalizeBookmarkSlots(slots: BookmarkSlots | undefined): BookmarkSlots {
  if (!slots) return {};
  const next: BookmarkSlots = {};
  for (const [key, line] of Object.entries(slots)) {
    const slot = Number(key);
    if (Number.isInteger(slot) && slot >= 1 && slot <= 9 && Number.isInteger(line) && line > 0) {
      next[String(slot)] = line;
    }
  }
  return next;
}

export function queryTabBookmarkSlots(tab: QueryTab): BookmarkSlots {
  return normalizeBookmarkSlots(tab.bookmarkSlots);
}

function pruneBookmarkSlots(slots: BookmarkSlots, lines: number[]): BookmarkSlots {
  return Object.fromEntries(Object.entries(slots).filter(([, line]) => lines.includes(line)));
}

function patchQueryTab(tabs: Tab[], id: string, patch: Partial<QueryTab>): Tab[] {
  return tabs.map((t) => (t.kind === "query" && t.id === id ? { ...t, ...patch } : t));
}

export function nextQueryTitle(tabs: Tab[]): string {
  const used = new Set(tabs.filter((t) => t.kind === "query").map((t) => t.title));
  let n = 1;
  while (used.has(`Query ${n}`)) n += 1;
  return `Query ${n}`;
}

const MAX_RECENTLY_CLOSED = 100;

function pushRecentlyClosed(current: ClosedTab[], closed: Tab[]): ClosedTab[] {
  if (closed.length === 0) return current;
  const { connections, activeId } = useConnectionsStore.getState();
  const connection = connections.find((entry) => entry.id === activeId);
  const database = activeId
    ? (useDbSelectionStore.getState().databaseByConnection[activeId] ??
      (connection ? databaseFromConnectionString(connection.connectionString) : null))
    : null;
  return [
    ...closed.map((tab) => ({
      ...tab,
      recoveryId: crypto.randomUUID(),
      closedAt: Date.now(),
      closedConnectionId: activeId,
      closedConnectionName: connection?.name,
      closedDatabase: database,
      ...(tab.kind === "query" ? { autoRun: false } : {}),
    })),
    ...current,
  ].slice(0, MAX_RECENTLY_CLOSED);
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
      recentlyClosed: [],

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
        const qt: QueryTab = {
          kind: "query",
          id: crypto.randomUUID(),
          title: nextQueryTitle(get().tabs),
          sql: "",
        };
        set((state) => storeFor([...state.tabs, qt], state));
        return qt.id;
      },

      openQueryTabWithSql: (sql, title, autoRun) => {
        const qt: QueryTab = {
          kind: "query",
          id: crypto.randomUUID(),
          title: title ?? nextQueryTitle(get().tabs),
          sql,
          autoRun,
        };
        set((state) => storeFor([...state.tabs, qt], state));
        return qt.id;
      },

      openSavedQueryTab: (tab) => {
        set((state) => {
          if (state.tabs.some((t) => t.kind === "query" && t.id === tab.id)) return state;
          return storeFor([...state.tabs, { kind: "query", ...tab }], state);
        });
      },

      openProcedureTab: (tab) => {
        const pr: ProcedureTab = { kind: "procedure", ...tab };
        const key = tabKey(pr);
        set((state) => {
          if (state.tabs.some((t) => tabKey(t) === key)) return state;
          return storeFor([...state.tabs, pr], state);
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

      openExtensionPanel: (tab) => {
        const et: ExtensionPanelTab = { kind: "extension-panel", ...tab };
        const key = tabKey(et);
        set((state) => {
          const index = state.tabs.findIndex((t) => tabKey(t) === key);
          if (index === -1) return storeFor([...state.tabs, et], state);
          const tabs = [...state.tabs];
          tabs[index] = et;
          return storeFor(tabs, state);
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

      openToolTab: (tool) => {
        const tt: ToolTab = { kind: "tool", tool };
        const key = tabKey(tt);
        set((state) => {
          if (state.tabs.some((t) => tabKey(t) === key)) return state;
          return storeFor([...state.tabs, tt], state);
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
        set((state) => {
          const closed = state.tabs.filter((t) => tabKey(t) === key);
          return {
            ...storeFor(
              state.tabs.filter((t) => tabKey(t) !== key),
              state,
            ),
            recentlyClosed: pushRecentlyClosed(state.recentlyClosed, closed),
          };
        }),

      closeOtherTabs: (key) =>
        set((state) => {
          const closed = state.tabs.filter((t) => tabKey(t) !== key);
          return {
            ...storeFor(
              state.tabs.filter((t) => tabKey(t) === key),
              state,
            ),
            recentlyClosed: pushRecentlyClosed(state.recentlyClosed, closed),
          };
        }),

      closeTabsToRight: (key) =>
        set((state) => {
          const index = state.tabs.findIndex((t) => tabKey(t) === key);
          if (index === -1) return state;
          const closed = state.tabs.slice(index + 1);
          return {
            ...storeFor(state.tabs.slice(0, index + 1), state),
            recentlyClosed: pushRecentlyClosed(state.recentlyClosed, closed),
          };
        }),

      closeAllTabs: () =>
        set((state) => ({
          ...storeFor([], state),
          recentlyClosed: pushRecentlyClosed(state.recentlyClosed, state.tabs),
        })),

      reopenLastTab: () => {
        const next = get().recentlyClosed.find(
          (entry) => (entry.closedConnectionId ?? null) === useConnectionsStore.getState().activeId,
        );
        return next?.recoveryId ? get().reopenClosedTab(next.recoveryId) : null;
      },

      reopenClosedTab: (id) => {
        const state = get();
        const next = state.recentlyClosed.find((entry) => entry.recoveryId === id);
        if (!next || (next.closedConnectionId ?? null) !== useConnectionsStore.getState().activeId)
          return null;
        const {
          recoveryId: _id,
          closedAt: _time,
          closedConnectionId: _connection,
          closedConnectionName: _name,
          closedDatabase: database,
          ...tab
        } = next;
        if (next.closedConnectionId && database)
          useDbSelectionStore.getState().setDatabase(next.closedConnectionId, database);
        const restored: Tab = tab.kind === "query" ? { ...tab, autoRun: false } : tab;
        const existing = state.tabs.find((entry) => tabKey(entry) === tabKey(restored));
        if (
          existing?.kind === "query" &&
          restored.kind === "query" &&
          existing.sql !== restored.sql
        )
          restored.id = crypto.randomUUID();
        set((current) => ({
          ...storeFor(
            current.tabs.some((entry) => tabKey(entry) === tabKey(restored))
              ? current.tabs
              : [...current.tabs, restored],
            current,
          ),
          recentlyClosed: current.recentlyClosed.filter((entry) => entry.recoveryId !== id),
        }));
        return restored;
      },

      forgetClosedTab: (id) =>
        set((state) => ({
          recentlyClosed: state.recentlyClosed.filter((entry) => entry.recoveryId !== id),
        })),

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
        set((state) => {
          const tab = state.tabs.find((entry) => entry.kind === "query" && entry.id === id);
          const patch =
            tab?.kind === "query" && tab.lastExecutedSql === undefined
              ? { sql, lastExecutedSql: tab.sql }
              : { sql };
          return storeFor(patchQueryTab(state.tabs, id, patch), state);
        }),

      markQueryTabExecuted: (id, sql) =>
        set((state) => storeFor(patchQueryTab(state.tabs, id, { lastExecutedSql: sql }), state)),

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
              savedSql: file.savedSql ?? tab.sql,
              fileMtime: file.mtime,
              externalChange: false,
            }),
            state,
          );
        }),

      markQueryTabSaved: (id, mtime, savedSql) =>
        set((state) => {
          const tab = state.tabs.find((t) => t.kind === "query" && t.id === id);
          if (!tab || tab.kind !== "query") return state;
          return storeFor(
            patchQueryTab(state.tabs, id, {
              savedSql: savedSql ?? tab.sql,
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

      toggleQueryBookmark: (id, line) =>
        set((state) => {
          const tab = state.tabs.find((t) => t.kind === "query" && t.id === id);
          if (!tab || tab.kind !== "query") return state;
          const current = queryTabBookmarks(tab);
          const next = current.includes(line)
            ? current.filter((entry) => entry !== line)
            : normalizeBookmarks([...current, line]);
          const patch: Partial<QueryTab> = { bookmarks: next };
          if (!next.includes(line)) {
            const slots = queryTabBookmarkSlots(tab);
            const pruned = pruneBookmarkSlots(slots, next);
            if (Object.keys(pruned).length !== Object.keys(slots).length) {
              patch.bookmarkSlots = pruned;
            }
          }
          return storeFor(patchQueryTab(state.tabs, id, patch), state);
        }),

      setQueryBookmarks: (id, lines) =>
        set((state) => {
          const tab = state.tabs.find((t) => t.kind === "query" && t.id === id);
          if (!tab || tab.kind !== "query") return state;
          const next = normalizeBookmarks(lines);
          const current = queryTabBookmarks(tab);
          const slots = queryTabBookmarkSlots(tab);
          const pruned = pruneBookmarkSlots(slots, next);
          const slotsChanged = Object.keys(pruned).length !== Object.keys(slots).length;
          if (
            !slotsChanged &&
            next.length === current.length &&
            next.every((line, i) => line === current[i])
          ) {
            return state;
          }
          return storeFor(
            patchQueryTab(state.tabs, id, {
              bookmarks: next,
              ...(slotsChanged ? { bookmarkSlots: pruned } : {}),
            }),
            state,
          );
        }),

      setQueryBookmarkSlot: (id, slot, line) =>
        set((state) => {
          const tab = state.tabs.find((t) => t.kind === "query" && t.id === id);
          if (!tab || tab.kind !== "query") return state;
          if (!Number.isInteger(slot) || slot < 1 || slot > 9) return state;
          const key = String(slot);
          const slots = queryTabBookmarkSlots(tab);
          if (line === null) {
            if (!(key in slots)) return state;
            const { [key]: removedLine, ...rest } = slots;
            if (Object.values(rest).includes(removedLine)) {
              return storeFor(patchQueryTab(state.tabs, id, { bookmarkSlots: rest }), state);
            }
            return storeFor(
              patchQueryTab(state.tabs, id, {
                bookmarkSlots: rest,
                bookmarks: queryTabBookmarks(tab).filter((entry) => entry !== removedLine),
              }),
              state,
            );
          }
          if (!Number.isInteger(line) || line <= 0) return state;
          if (slots[key] === line) return state;
          return storeFor(
            patchQueryTab(state.tabs, id, {
              bookmarkSlots: { ...slots, [key]: line },
              bookmarks: normalizeBookmarks([...queryTabBookmarks(tab), line]),
            }),
            state,
          );
        }),

      clearQueryBookmarks: (id) =>
        set((state) =>
          storeFor(patchQueryTab(state.tabs, id, { bookmarks: [], bookmarkSlots: {} }), state),
        ),
    }),
    {
      name: "l8db.table-tabs",
      storage: createBufferedJsonStorage(() => window.localStorage),
      version: 4,
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
          };
        }
        if (version === 1) {
          const old = persistedState as { tabs: TableTab[] };
          const tabs: Tab[] = (old.tabs ?? []).map((t) =>
            t.kind === "table" ? { ...t, entityType: t.entityType ?? "table" } : t,
          );
          const activeId = readPersistedActiveConnectionId();
          return {
            tabs,
            tabsByConnection: activeId ? { [activeId]: tabs } : {},
          };
        }
        if (version === 2) {
          const old = persistedState as { tabs: Tab[] };
          const tabs = old.tabs ?? [];
          const activeId = readPersistedActiveConnectionId();
          return {
            tabs,
            tabsByConnection: activeId ? { [activeId]: tabs } : {},
          };
        }
        return persistedState;
      },
      partialize: (state) => ({
        tabsByConnection: state.tabsByConnection,
        recentlyClosed: state.recentlyClosed,
      }),
      merge: (persistedState, currentState) => {
        const stored = persistedState as Partial<TabsState> | undefined;
        const tabsByConnection = stored?.tabsByConnection ?? {};
        const key = keyForConnection(useConnectionsStore.getState().activeId);
        return {
          ...currentState,
          recentlyClosed: stored?.recentlyClosed ?? [],
          tabsByConnection,
          tabs: tabsByConnection[key] ?? [],
        };
      },
    },
  ),
);

useConnectionsStore.subscribe((state, previous) => {
  if (state.activeId === previous.activeId) return;
  useTableTabs.setState({
    tabs: useTableTabs.getState().tabsByConnection[keyForConnection(state.activeId)] ?? [],
  });
});
