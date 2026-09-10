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
  addPane: (activeKey: string | null, preferredKey?: string | null) => void;
  closePane: (index: number) => void;
  collapse: () => void;
  focusPane: (index: number) => void;
  reveal: (key: string) => void;
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
          if (keyForConnection(useConnectionsStore.getState().activeId) === connectionId) {
            return { panes: [], focusedPane: 0, byConnection };
          }
          return { byConnection };
        }),
    }),
    {
      name: "l8db.split-view",
      partialize: (state) => ({
        panes: state.panes,
        focusedPane: state.focusedPane,
        byConnection: state.byConnection,
      }),
      onRehydrateStorage: () => (rehydratedState) => {
        if (!rehydratedState) return;
        if (!useConnectionsStore.persist.hasHydrated()) return;
        const key = keyForConnection(useConnectionsStore.getState().activeId);
        const stored = rehydratedState.byConnection[key];
        if (stored) {
          useSplitView.setState({
            panes: stored.panes,
            focusedPane: stored.focusedPane,
          });
        }
      },
    },
  ),
);

useConnectionsStore.subscribe((state, previous) => {
  const nextId = state.activeId;
  const previousId = previous.activeId;
  if (nextId === previousId) return;
  const current = useSplitView.getState();
  const nextKey = keyForConnection(nextId);
  if (!useConnectionsStore.persist.hasHydrated() || !useSplitView.persist.hasHydrated()) {
    const stored = current.byConnection[nextKey];
    if (stored) {
      useSplitView.setState({ panes: stored.panes, focusedPane: stored.focusedPane });
    }
    return;
  }
  const prevKey = keyForConnection(previousId);
  const prevSnapshot = current.byConnection[prevKey];
  const keepPrevSnapshot = current.panes.length === 0 && (prevSnapshot?.panes.length ?? 0) > 0;
  useSplitView.setState({
    byConnection: {
      ...current.byConnection,
      ...(keepPrevSnapshot
        ? {}
        : { [prevKey]: { panes: current.panes, focusedPane: current.focusedPane } }),
    },
    panes: current.byConnection[nextKey]?.panes ?? [],
    focusedPane: current.byConnection[nextKey]?.focusedPane ?? 0,
  });
});

useTableTabs.subscribe((state, previous) => {
  if (state.tabs === previous.tabs) return;
  useSplitView.getState().prune(new Set(state.tabs.map(tabKey)));
});
