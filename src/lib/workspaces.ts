import { create } from "zustand";
import { persist } from "zustand/middleware";

import { useConnectionsStore } from "@/lib/connections";
import { isQueryTabDirty, type QueryTab, type Tab, tabKey } from "@/lib/table-tabs";

export interface WorkspaceSnapshot {
  tabs: Tab[];
  panes: (string | null)[];
  focusedPane: number;
  activeTabKey: string | null;
}

export interface Workspace {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  snapshot: WorkspaceSnapshot;
}

export type WorkspaceOpenMode = "replace" | "merge";

export interface WorkspaceRestore {
  snapshot: WorkspaceSnapshot;
  warnings: string[];
}

const OBJECT_TAB_KINDS = new Set(["table", "view-editor", "alter-table"]);

function objectLabel(tab: Tab): string | null {
  if (tab.kind === "table") return `${tab.schema}.${tab.table}`;
  if (tab.kind === "view-editor") return `${tab.schema}.${tab.view}`;
  if (tab.kind === "alter-table") return `${tab.schema}.${tab.table}`;
  return null;
}

function cloneTab(tab: Tab): Tab {
  if (tab.kind !== "query") return { ...tab };
  const query: QueryTab = {
    kind: "query",
    id: tab.id,
    title: tab.title,
    sql: tab.sql,
    externalChange: false,
  };
  if (tab.filePath !== undefined) query.filePath = tab.filePath;
  if (tab.savedSql !== undefined) query.savedSql = tab.savedSql;
  if (tab.fileMtime !== undefined) query.fileMtime = tab.fileMtime;
  if (tab.bookmarks && tab.bookmarks.length > 0) query.bookmarks = [...tab.bookmarks];
  return query;
}

function normalizePanes(
  panes: (string | null)[],
  keys: Set<string>,
  focusedPane: number,
): { panes: (string | null)[]; focusedPane: number } {
  const mapped = panes.map((key) => (key && keys.has(key) ? key : null));
  if (mapped.length <= 1 || mapped.every((key) => key === null)) {
    return { panes: [], focusedPane: 0 };
  }
  const focused = focusedPane >= 0 && focusedPane < mapped.length ? focusedPane : 0;
  return { panes: mapped, focusedPane: focused };
}

export function createWorkspaceSnapshot(input: {
  tabs: Tab[];
  panes: (string | null)[];
  focusedPane: number;
  activeTabKey: string | null;
}): WorkspaceSnapshot {
  const tabs = input.tabs.map(cloneTab);
  const keys = new Set(tabs.map(tabKey));
  const { panes, focusedPane } = normalizePanes(input.panes, keys, input.focusedPane);
  const activeTabKey =
    input.activeTabKey && keys.has(input.activeTabKey) ? input.activeTabKey : null;
  return { tabs, panes, focusedPane, activeTabKey };
}

function pickActiveKey(
  preferred: string | null,
  fallback: string | null,
  keys: Set<string>,
  tabs: Tab[],
): string | null {
  if (preferred && keys.has(preferred)) return preferred;
  if (fallback && keys.has(fallback)) return fallback;
  return tabs.length > 0 ? tabKey(tabs[0]) : null;
}

export function restoreWorkspaceSnapshot(
  current: WorkspaceSnapshot,
  saved: WorkspaceSnapshot,
  mode: WorkspaceOpenMode,
  knownObjectKeys?: string[] | null,
): WorkspaceRestore {
  const warnings: string[] = [];

  let savedTabs = saved.tabs.map(cloneTab);
  if (knownObjectKeys) {
    const known = new Set(knownObjectKeys);
    const missing: string[] = [];
    savedTabs = savedTabs.filter((tab) => {
      if (!OBJECT_TAB_KINDS.has(tab.kind)) return true;
      const label = objectLabel(tab);
      if (!label || known.has(label)) return true;
      missing.push(label);
      return false;
    });
    if (missing.length > 0) {
      warnings.push(
        `Nicht mehr vorhandene Objekte übersprungen: ${[...new Set(missing)].join(", ")}`,
      );
    }
  }

  if (saved.tabs.length === 0) {
    warnings.push("Der Arbeitsplatzstand enthält keine Tabs.");
  }

  let tabs: Tab[];
  if (mode === "replace") {
    const savedKeys = new Set(savedTabs.map(tabKey));
    const lostEdits = current.tabs
      .filter((tab) => tab.kind === "query" && isQueryTabDirty(tab) && !savedKeys.has(tabKey(tab)))
      .map((tab) => (tab.kind === "query" ? tab.title : ""));
    if (lostEdits.length > 0) {
      warnings.push(`Ungespeicherte Dateiänderungen gehen verloren: ${lostEdits.join(", ")}`);
    }
    tabs = savedTabs;
  } else {
    const existing = new Set(current.tabs.map(tabKey));
    tabs = [...current.tabs.map(cloneTab)];
    for (const tab of savedTabs) {
      const key = tabKey(tab);
      if (existing.has(key)) continue;
      existing.add(key);
      tabs.push(tab);
    }
  }

  const keys = new Set(tabs.map(tabKey));
  const source = mode === "replace" ? saved : current;
  const { panes, focusedPane } = normalizePanes(source.panes, keys, source.focusedPane);
  const activeTabKey =
    mode === "replace"
      ? pickActiveKey(saved.activeTabKey, current.activeTabKey, keys, tabs)
      : pickActiveKey(current.activeTabKey, saved.activeTabKey, keys, tabs);

  return { snapshot: { tabs, panes, focusedPane, activeTabKey }, warnings };
}

export function findWorkspaceByName(list: Workspace[], name: string): Workspace | undefined {
  const normalized = name.trim().toLowerCase();
  return list.find((entry) => entry.name.toLowerCase() === normalized);
}

export function addWorkspace(
  list: Workspace[],
  name: string,
  snapshot: WorkspaceSnapshot,
  options?: { id?: string; now?: number },
): Workspace[] {
  const trimmed = name.trim();
  if (!trimmed) return list;
  const now = options?.now ?? Date.now();
  const existing = findWorkspaceByName(list, trimmed);
  if (existing) {
    return list.map((entry) =>
      entry.id === existing.id ? { ...entry, name: trimmed, snapshot, updatedAt: now } : entry,
    );
  }
  return [
    ...list,
    {
      id: options?.id ?? crypto.randomUUID(),
      name: trimmed,
      createdAt: now,
      updatedAt: now,
      snapshot,
    },
  ];
}

export function renameWorkspace(
  list: Workspace[],
  id: string,
  name: string,
  now?: number,
): Workspace[] {
  const trimmed = name.trim();
  if (!trimmed) return list;
  const clash = findWorkspaceByName(list, trimmed);
  if (clash && clash.id !== id) return list;
  return list.map((entry) =>
    entry.id === id ? { ...entry, name: trimmed, updatedAt: now ?? Date.now() } : entry,
  );
}

export function deleteWorkspace(list: Workspace[], id: string): Workspace[] {
  return list.filter((entry) => entry.id !== id);
}

const NONE_KEY = "__none__";

function keyForConnection(id: string | null | undefined): string {
  return id ?? NONE_KEY;
}

interface WorkspacesState {
  byConnection: Record<string, Workspace[]>;
  saveWorkspace: (name: string, snapshot: WorkspaceSnapshot) => void;
  renameWorkspace: (id: string, name: string) => void;
  deleteWorkspace: (id: string) => void;
  clearForConnection: (connectionId: string) => void;
}

function update(
  state: WorkspacesState,
  updater: (list: Workspace[]) => Workspace[],
): Pick<WorkspacesState, "byConnection"> {
  const key = keyForConnection(useConnectionsStore.getState().activeId);
  return { byConnection: { ...state.byConnection, [key]: updater(state.byConnection[key] ?? []) } };
}

export const useWorkspacesStore = create<WorkspacesState>()(
  persist(
    (set) => ({
      byConnection: {},

      saveWorkspace: (name, snapshot) =>
        set((state) => update(state, (list) => addWorkspace(list, name, snapshot))),

      renameWorkspace: (id, name) =>
        set((state) => update(state, (list) => renameWorkspace(list, id, name))),

      deleteWorkspace: (id) => set((state) => update(state, (list) => deleteWorkspace(list, id))),

      clearForConnection: (connectionId) =>
        set((state) => {
          const byConnection = { ...state.byConnection };
          delete byConnection[connectionId];
          return { byConnection };
        }),
    }),
    {
      name: "l8db.workspaces",
      partialize: (state) => ({ byConnection: state.byConnection }),
    },
  ),
);

export function workspacesFor(
  byConnection: Record<string, Workspace[]>,
  connectionId: string | null | undefined,
): Workspace[] {
  return byConnection[keyForConnection(connectionId)] ?? [];
}
