import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createBufferedJsonStorage } from "@/lib/buffered-storage";
import { useConnectionsStore } from "@/lib/connections";
import {
  forgetSchemaCompare,
  LEGACY_SCHEMA_COMPARE_ID,
  schemaCompareIds,
} from "@/lib/schema-compare/persistence";
import { syncAcrossWindows } from "@/lib/window-sync";
import { createCloseActions } from "./close-actions";
import { createOpenActions } from "./open-actions";
import { createQueryActions } from "./query-actions";
import { keyForConnection, readPersistedActiveConnectionId, tabKey } from "./tab-keys";
import type { Tab, TableTab, TabsState } from "./types";

const isSchemaCompare = (tab: Tab) => tab.kind === "tool" && tab.tool === "schema-compare";

function withSchemaCompareId<T extends Tab>(tab: T): T {
  return tab.kind === "tool" && tab.tool === "schema-compare" && !tab.id
    ? { ...tab, id: LEGACY_SCHEMA_COMPARE_ID }
    : tab;
}

export const useTableTabs = create<TabsState>()(
  persist(
    (set, get) => ({
      tabs: [],
      tabsByConnection: {},
      recentlyClosed: [],

      ...createOpenActions(set, get),
      ...createCloseActions(set, get),
      ...createQueryActions(set, get),
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
        tabsByConnection: Object.fromEntries(
          Object.entries(state.tabsByConnection).map(([key, tabs]) => [
            key,
            tabs.filter((tab) => !(tab.kind === "tool" && tab.tool === "workbench")),
          ]),
        ),
        recentlyClosed: state.recentlyClosed,
      }),
      merge: (persistedState, currentState) => {
        const stored = persistedState as Partial<TabsState> | undefined;
        const tabsByConnection = Object.fromEntries(
          Object.entries(stored?.tabsByConnection ?? {}).map(([key, tabs]) => [
            key,
            tabs.map(withSchemaCompareId),
          ]),
        );
        const key = keyForConnection(useConnectionsStore.getState().activeId);
        return {
          ...currentState,
          recentlyClosed: (stored?.recentlyClosed ?? []).map(withSchemaCompareId),
          tabsByConnection,
          tabs: tabsByConnection[key] ?? [],
        };
      },
    },
  ),
);

useConnectionsStore.subscribe((state, previous) => {
  if (state.activeId === previous.activeId) return;
  const current = useTableTabs.getState();
  const key = keyForConnection(state.activeId);
  const next = current.tabsByConnection[key] ?? [];
  const carried = current.tabs.filter(isSchemaCompare);
  if (carried.length === 0) {
    useTableTabs.setState({ tabs: next });
    return;
  }
  const keys = new Set(next.map(tabKey));
  const tabs = [...next, ...carried.filter((tab) => !keys.has(tabKey(tab)))];
  useTableTabs.setState({
    tabs,
    tabsByConnection: {
      ...current.tabsByConnection,
      [keyForConnection(previous.activeId)]: current.tabs.filter((tab) => !isSchemaCompare(tab)),
      [key]: tabs,
    },
  });
});

let syncing = false;

useTableTabs.subscribe((state, previous) => {
  if (
    syncing ||
    (state.tabsByConnection === previous.tabsByConnection &&
      state.recentlyClosed === previous.recentlyClosed &&
      state.tabs === previous.tabs)
  )
    return;
  const all = (value: TabsState) => [
    value.tabs,
    value.recentlyClosed,
    ...Object.values(value.tabsByConnection),
  ];
  const kept = schemaCompareIds(all(state));
  for (const id of schemaCompareIds(all(previous))) if (!kept.has(id)) void forgetSchemaCompare(id);
});

export function mergeWindowTabs(
  stored: Record<string, Tab[]>,
  current: Record<string, Tab[]>,
  key: string,
): Record<string, Tab[]> {
  return current[key] ? { ...stored, [key]: current[key] } : stored;
}

syncAcrossWindows("l8db.table-tabs", (value) => {
  let stored: Record<string, Tab[]> | undefined;
  try {
    stored = (JSON.parse(value ?? "null") as { state?: Partial<TabsState> } | null)?.state
      ?.tabsByConnection;
  } catch {
    return;
  }
  if (!stored) return;
  const current = useTableTabs.getState().tabsByConnection;
  const next = mergeWindowTabs(
    stored,
    current,
    keyForConnection(useConnectionsStore.getState().activeId),
  );
  if (JSON.stringify(next) === JSON.stringify(current)) return;
  syncing = true;
  try {
    useTableTabs.setState({ tabsByConnection: next });
  } finally {
    syncing = false;
  }
});
