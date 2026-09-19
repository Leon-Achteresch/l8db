import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createBufferedJsonStorage } from "@/lib/buffered-storage";
import { useConnectionsStore } from "@/lib/connections";
import { createCloseActions } from "./close-actions";
import { createOpenActions } from "./open-actions";
import { createQueryActions } from "./query-actions";
import { keyForConnection, readPersistedActiveConnectionId } from "./tab-keys";
import type { Tab, TableTab, TabsState } from "./types";

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
