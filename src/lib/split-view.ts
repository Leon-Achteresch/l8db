import { create } from "zustand";
import { persist } from "zustand/middleware";

import { useConnectionsStore } from "@/lib/connections";
import {
  isAncestor,
  normalizeMasters,
  type PaneMasters,
  removeMaster,
  swapMasters,
} from "@/lib/split-links";
import { type Tab, tabKey, useTableTabs } from "@/lib/table-tabs";

export const MAX_SPLIT_PANES = 4;

const NONE_KEY = "__none__";

function keyForConnection(id: string | null | undefined): string {
  return id ?? NONE_KEY;
}

export type SplitOrientation = "horizontal" | "vertical";

export type SplitSnapshot = {
  orientation?: SplitOrientation;
  panes: (string | null)[];
  masters?: PaneMasters;
  focusedPane: number;
};

interface SplitState {
  orientation: SplitOrientation;
  setOrientation: (orientation: SplitOrientation) => void;
  panes: (string | null)[];
  masters: PaneMasters;
  setMaster: (detail: number, master: number | null) => void;
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
  state: Pick<SplitState, "byConnection" | "orientation" | "masters">,
  masters = state.masters,
): Pick<SplitState, "panes" | "focusedPane" | "byConnection" | "masters"> {
  return {
    panes,
    masters,
    focusedPane,
    byConnection: {
      ...state.byConnection,
      [keyForConnection(useConnectionsStore.getState().activeId)]: {
        panes,
        masters,
        focusedPane,
        orientation: state.orientation,
      },
    },
  };
}

function restore(
  entry: SplitSnapshot | undefined,
): Pick<SplitState, "panes" | "masters" | "focusedPane" | "orientation"> {
  const panes = entry?.panes ?? [];
  return {
    panes,
    masters: normalizeMasters(entry?.masters, panes.length),
    focusedPane: entry?.focusedPane ?? 0,
    orientation: entry?.orientation ?? "horizontal",
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
      masters: [],
      focusedPane: 0,
      orientation: "horizontal",
      setMaster: (detail, master) =>
        set((state) => {
          if (detail < 0 || detail >= state.panes.length || state.masters[detail] === master)
            return state;
          if (
            master !== null &&
            (master < 0 ||
              master >= state.panes.length ||
              master === detail ||
              isAncestor(state.masters, detail, master))
          )
            return state;
          const masters = [...state.masters];
          masters[detail] = master;
          return snapshot(state.panes, state.focusedPane, state, masters);
        }),
      setOrientation: (orientation) =>
        set((state) => ({
          ...snapshot(state.panes, state.focusedPane, { ...state, orientation }),
          orientation,
        })),
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
          const masters = state.panes.length === 0 ? [null] : state.masters;
          return snapshot([...base, fill], base.length, state, [
            ...masters,
            state.panes.length === 0 ? 0 : state.focusedPane,
          ]);
        }),

      closePane: (index) =>
        set((state) => {
          if (state.panes.length <= 1) return snapshot([], 0, state, []);
          const panes = state.panes.filter((_, i) => i !== index);
          if (panes.length <= 1) return snapshot([], 0, state, []);
          const focusedPane =
            state.focusedPane === index
              ? Math.min(index, panes.length - 1)
              : state.focusedPane > index
                ? state.focusedPane - 1
                : state.focusedPane;
          return snapshot(panes, focusedPane, state, removeMaster(state.masters, index));
        }),

      collapse: () => set((state) => snapshot([], 0, state, [])),

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
          return snapshot(
            panes,
            index,
            state,
            existing === -1 ? state.masters : swapMasters(state.masters, existing, index),
          );
        }),

      swapPanes: (from, to) =>
        set((state) => {
          const max = state.panes.length;
          if (from === to || from < 0 || to < 0 || from >= max || to >= max) return state;
          const panes = [...state.panes];
          [panes[from], panes[to]] = [panes[to], panes[from]];
          return snapshot(panes, to, state, swapMasters(state.masters, from, to));
        }),

      prune: (validKeys) =>
        set((state) => {
          if (state.panes.length <= 1) return state;
          const panes = state.panes.map((key) => (key && validKeys.has(key) ? key : null));
          if (panes.every((key) => key == null)) return snapshot([], 0, state, []);
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
            return {
              panes: [],
              masters: [],
              focusedPane: 0,
              orientation: "horizontal",
              byConnection,
              paneConnections,
            };
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
          ...restore(byConnection[key]),
        };
      },
    },
  ),
);

export function usePaneTabs(): (Tab | undefined)[] {
  const panes = useSplitView((state) => state.panes);
  const tabs = useTableTabs((state) => state.tabs);
  return panes.map((key) => tabs.find((tab) => tabKey(tab) === key));
}

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
  useSplitView.setState(
    restore(useSplitView.getState().byConnection[keyForConnection(state.activeId)]),
  );
});

useTableTabs.subscribe((state, previous) => {
  if (state.tabs === previous.tabs) return;
  if (splitConnectionId !== useConnectionsStore.getState().activeId) return;
  useSplitView.getState().prune(new Set(state.tabs.map(tabKey)));
});
