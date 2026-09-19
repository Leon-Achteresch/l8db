import { useConnectionsStore } from "@/lib/connections";
import { useDbSelectionStore } from "@/lib/db-selection";
import { pushRecentlyClosed, storeFor } from "./helpers";
import { keyForConnection, tabKey } from "./tab-keys";
import type { Tab, TabsGet, TabsSet, TabsState } from "./types";

export function createCloseActions(
  set: TabsSet,
  get: TabsGet,
): Pick<
  TabsState,
  | "closeTab"
  | "closeOtherTabs"
  | "closeTabsToRight"
  | "closeAllTabs"
  | "reopenLastTab"
  | "reopenClosedTab"
  | "forgetClosedTab"
  | "clearTabsForConnection"
  | "reorderTabs"
> {
  return {
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
      if (existing?.kind === "query" && restored.kind === "query" && existing.sql !== restored.sql)
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
  };
}
