import { create } from "zustand";
import { persist } from "zustand/middleware";

import { useConnectionsStore } from "@/lib/connections";
import { tabKey, useTableTabs } from "@/lib/table-tabs";

export const MAX_SPLIT_PANES = 4;

const NONE_KEY = "__none__";

function keyForConnection(id: string | null | undefined): string {
  return id ?? NONE_KEY;
}

export type SplitSnapshot = {
  panes: (string | null)[];
  focusedPane: number;
};

interface SplitState {
  panes: (string | null)[];
  focusedPane: number;
  byConnection: Record<string, SplitSnapshot>;
  paneConnections: Record<string, string>;
  setPaneConnection: (tabKey: string, connectionId: string | null) => void;
  addPane: (activeKey: string | null, preferredKey?: string | null) => void;
  closePane: (index: number) => void;
  collapse: () => void;
  focusPane: (index: number) => void;
  reveal: (key: string) => void;
  setPane: (index: number, key: string) => void;
  swapPanes: (from: number, to: number) => void;
  prune: (validKeys: Set<string>) => void;
  clearForConnection: (connectionId: string) => void;
}

function snapshot(
  panes: (string | null)[],
  focusedPane: number,
  state: { byConnection: Record<string, SplitSnapshot> },
): Pick<SplitState, "panes" | "focusedPane" | "byConnection"> {
  return {
    panes,
    focusedPane,
    byConnection: {
      ...state.byConnection,
      [keyForConnection(useConnectionsStore.getState().activeId)]: { panes, focusedPane },
    },
  };
}

function nextFill(used: Set<string>, preferredKey?: string | null): string | null {
  if (preferredKey && !used.has(preferredKey)) return preferredKey;
  const unused = useTableTabs.getState().tabs.find((tab) => !used.has(tabKey(tab)));
  return unused ? tabKey(unused) : null;
}

export const useSplitView = create<SplitState>()(
  persist(
    (set) => ({
      panes: [],
      focusedPane: 0,
      byConnection: {},
      paneConnections: {},

      setPaneConnection: (key, connectionId) =>
        set((state) => {
          const scoped = `${keyForConnection(useConnectionsStore.getState().activeId)}|${key}`;
          const paneConnections = { ...state.paneConnections };
          if (connectionId) paneConnections[scoped] = connectionId;
          else delete paneConnections[scoped];
          return { paneConnections };
        }),

      addPane: (activeKey, preferredKey) =>
        set((state) => {
          if (state.panes.length >= MAX_SPLIT_PANES) return state;
          const base =
            state.panes.length === 0
              ? activeKey
                ? [activeKey]
                : preferredKey
                  ? [preferredKey]
                  : []
              : state.panes;
          if (base.length === 0 || base.length >= MAX_SPLIT_PANES) return state;
          const used = new Set(base.filter((key): key is string => key != null));
          const fill = nextFill(used, preferredKey);
          return snapshot([...base, fill], base.length, state);
        }),

      closePane: (index) =>
        set((state) => {
          if (state.panes.length <= 1) return snapshot([], 0, state);
          const panes = state.panes.filter((_, i) => i !== index);
          if (panes.length <= 1) return snapshot([], 0, state);
          const focusedPane =
            state.focusedPane === index
              ? Math.min(index, panes.length - 1)
              : state.focusedPane > index
                ? state.focusedPane - 1
                : state.focusedPane;
          return snapshot(panes, focusedPane, state);
        }),

      collapse: () => set((state) => snapshot([], 0, state)),

      focusPane: (index) =>
        set((state) => {
          if (index < 0 || index >= state.panes.length || index === state.focusedPane) {
            return state;
          }
          return snapshot(state.panes, index, state);
        }),

      reveal: (key) =>
        set((state) => {
          if (state.panes.length <= 1) return state;
          const index = state.panes.indexOf(key);
          if (index !== -1) {
            return index === state.focusedPane ? state : snapshot(state.panes, index, state);
          }
          const panes = [...state.panes];
          panes[state.focusedPane] = key;
          return snapshot(panes, state.focusedPane, state);
        }),

      setPane: (index, key) =>
        set((state) => {
          if (index < 0 || index >= state.panes.length) return state;
          if (state.panes[index] === key) {
            return index === state.focusedPane ? state : snapshot(state.panes, index, state);
          }
          const panes = [...state.panes];
          const existing = panes.indexOf(key);
          if (existing !== -1) panes[existing] = panes[index];
          panes[index] = key;
          return snapshot(panes, index, state);
        }),

      swapPanes: (from, to) =>
        set((state) => {
          const max = state.panes.length;
          if (from === to || from < 0 || to < 0 || from >= max || to >= max) return state;
          const panes = [...state.panes];
          [panes[from], panes[to]] = [panes[to], panes[from]];
          return snapshot(panes, to, state);
        }),

      prune: (validKeys) =>
        set((state) => {
          if (state.panes.length <= 1) return state;
          const panes = state.panes.map((key) => (key && validKeys.has(key) ? key : null));
          if (panes.every((key) => key == null)) return snapshot([], 0, state);
          if (panes.every((key, i) => key === state.panes[i])) return state;
          return snapshot(panes, state.focusedPane, state);
        }),

      clearForConnection: (connectionId) =>
        set((state) => {
          const byConnection = { ...state.byConnection };
          delete byConnection[connectionId];
          const paneConnections = Object.fromEntries(
            Object.entries(state.paneConnections).filter(
              ([key, value]) => !key.startsWith(`${connectionId}|`) && value !== connectionId,
            ),
          );
          if (keyForConnection(useConnectionsStore.getState().activeId) === connectionId) {
            return { panes: [], focusedPane: 0, byConnection, paneConnections };
          }
          return { byConnection, paneConnections };
        }),
    }),
    {
      name: "l8db.split-view",
      partialize: (state) => ({
        byConnection: state.byConnection,
        paneConnections: state.paneConnections,
      }),
      merge: (persistedState, currentState) => {
        const stored = persistedState as Partial<SplitState> | undefined;
        const byConnection = stored?.byConnection ?? {};
        const key = keyForConnection(useConnectionsStore.getState().activeId);
        return {
          ...currentState,
          byConnection,
          paneConnections: stored?.paneConnections ?? {},
          panes: byConnection[key]?.panes ?? [],
          focusedPane: byConnection[key]?.focusedPane ?? 0,
        };
      },
    },
  ),
);

export function usePaneConnectionId(key: string | null): string | null {
  const activeId = useConnectionsStore((state) => state.activeId);
  const connections = useConnectionsStore((state) => state.connections);
  const override = useSplitView((state) =>
    key ? (state.paneConnections[`${keyForConnection(activeId)}|${key}`] ?? null) : null,
  );
  if (!override || override === activeId) return null;
  return connections.some((entry) => entry.id === override) ? override : null;
}

let splitConnectionId = useConnectionsStore.getState().activeId;

useConnectionsStore.subscribe((state, previous) => {
  if (state.activeId === previous.activeId) return;
  splitConnectionId = state.activeId;
  const current = useSplitView.getState();
  const nextKey = keyForConnection(state.activeId);
  useSplitView.setState({
    panes: current.byConnection[nextKey]?.panes ?? [],
    focusedPane: current.byConnection[nextKey]?.focusedPane ?? 0,
  });
});

useTableTabs.subscribe((state, previous) => {
  if (state.tabs === previous.tabs) return;
  if (splitConnectionId !== useConnectionsStore.getState().activeId) return;
  useSplitView.getState().prune(new Set(state.tabs.map(tabKey)));
});
