import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createChangedOnlyJsonStorage } from "@/lib/buffered-storage";

import { useConnectionsStore } from "@/lib/connections";
import {
  isAncestor,
  normalizeMasters,
  type PaneMasters,
  removeMaster,
  swapMasters,
} from "@/lib/split-links";
import { remoteTab, type Tab, tabKey, useTableTabs } from "@/lib/table-tabs";
import { storeFor } from "@/lib/table-tabs/helpers";
import { syncAcrossWindows } from "@/lib/window-sync";

export const MAX_SPLIT_PANES = 4;

export const MAX_SPLIT_GROUPS = 50;

const DEFAULT_GROUP_NAME = /^Ansicht \d+$/;

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
  group?: string | null;
};

export type SplitGroup = {
  id: string;
  name: string;
  tabs: (Tab | null)[];
  masters: PaneMasters;
  orientation: SplitOrientation;
  focusedPane: number;
};

interface SplitState {
  orientation: SplitOrientation;
  setOrientation: (orientation: SplitOrientation) => void;
  panes: (string | null)[];
  masters: PaneMasters;
  setMaster: (detail: number, master: number | null) => void;
  focusedPane: number;
  activeGroup: string | null;
  groups: Record<string, SplitGroup[]>;
  openGroup: (id: string) => Tab | null;
  renameGroup: (id: string, name: string) => void;
  deleteGroup: (id: string) => void;
  byConnection: Record<string, SplitSnapshot>;
  paneConnections: Record<string, string>;
  setPaneConnection: (tabKey: string, connectionId: string | null) => void;
  addPane: (activeKey: string | null, preferredKey?: string | null) => void;
  closePane: (index: number) => void;
  collapse: () => void;
  focusPane: (index: number) => void;
  reveal: (key: string) => void;
  setPane: (index: number, key: string) => void;
  setPaneTab: (index: number, connectionId: string | null, tab: Tab | null) => void;
  swapPanes: (from: number, to: number) => void;
  prune: (validKeys: Set<string>) => void;
  clearForConnection: (connectionId: string) => void;
}

function paneTab(key: string | null, previous: (Tab | null)[]): Tab | null {
  if (!key) return null;
  const live = useTableTabs.getState().tabs.find((tab) => tabKey(tab) === key);
  if (live?.kind === "query") return { kind: "query", id: live.id, title: live.title, sql: "" };
  return remoteTab(key) ?? live ?? previous.find((tab) => tab && tabKey(tab) === key) ?? null;
}

function syncedGroups(
  state: Pick<SplitState, "groups" | "activeGroup" | "orientation">,
  scope: string,
  panes: (string | null)[],
  masters: PaneMasters,
  focusedPane: number,
): Record<string, SplitGroup[]> {
  const list = state.groups[scope];
  if (!state.activeGroup || !list?.some((group) => group.id === state.activeGroup))
    return state.groups;
  return {
    ...state.groups,
    [scope]: list.map((group) =>
      group.id === state.activeGroup
        ? {
            ...group,
            tabs: panes.map((key) => paneTab(key, group.tabs)),
            masters,
            focusedPane,
            orientation: state.orientation,
          }
        : group,
    ),
  };
}

function ensureGroup(
  state: Pick<SplitState, "groups" | "activeGroup" | "orientation">,
  scope: string,
  panes: (string | null)[],
  masters: PaneMasters,
  focusedPane: number,
): Pick<SplitState, "groups" | "activeGroup"> & { adopted: SplitGroup | null } {
  const existing = state.groups[scope] ?? [];
  if (state.activeGroup && existing.some((group) => group.id === state.activeGroup))
    return { groups: state.groups, activeGroup: state.activeGroup, adopted: null };
  const keys = panes.join("\0");
  const same = existing.find(
    (group) => group.tabs.map((tab) => (tab ? tabKey(tab) : "")).join("\0") === keys,
  );
  if (same) return { groups: state.groups, activeGroup: same.id, adopted: same };
  const stale =
    existing.length >= MAX_SPLIT_GROUPS
      ? existing.find((group) => DEFAULT_GROUP_NAME.test(group.name))
      : undefined;
  const list = stale ? existing.filter((group) => group !== stale) : existing;
  let number = 1;
  while (list.some((group) => group.name === `Ansicht ${number}`)) number++;
  const group: SplitGroup = {
    id: crypto.randomUUID(),
    name: `Ansicht ${number}`,
    tabs: panes.map((key) => paneTab(key, [])),
    masters,
    orientation: state.orientation,
    focusedPane,
  };
  return {
    groups: { ...state.groups, [scope]: [...list, group] },
    activeGroup: group.id,
    adopted: null,
  };
}

function snapshot(
  panes: (string | null)[],
  focusedPane: number,
  state: Pick<SplitState, "byConnection" | "orientation" | "masters" | "groups" | "activeGroup">,
  liveMasters = state.masters,
): Pick<
  SplitState,
  "panes" | "focusedPane" | "byConnection" | "masters" | "groups" | "activeGroup" | "orientation"
> {
  const scope = keyForConnection(useConnectionsStore.getState().activeId);
  const split = panes.length > 1;
  const grouped = split
    ? ensureGroup(state, scope, panes, liveMasters, focusedPane)
    : { groups: state.groups, activeGroup: null, adopted: null };
  const { activeGroup, adopted } = grouped;
  const masters = adopted ? normalizeMasters(adopted.masters, panes.length) : liveMasters;
  const orientation = adopted?.orientation ?? state.orientation;
  return {
    panes,
    masters,
    focusedPane,
    activeGroup,
    orientation,
    groups: split
      ? syncedGroups(
          { groups: grouped.groups, activeGroup, orientation },
          scope,
          panes,
          masters,
          focusedPane,
        )
      : state.groups,
    byConnection: {
      ...state.byConnection,
      [scope]: {
        panes,
        masters,
        focusedPane,
        orientation,
        group: activeGroup,
      },
    },
  };
}

function restore(
  entry: SplitSnapshot | undefined,
): Pick<SplitState, "panes" | "masters" | "focusedPane" | "orientation" | "activeGroup"> {
  const panes = entry?.panes ?? [];
  return {
    panes,
    masters: normalizeMasters(entry?.masters, panes.length),
    focusedPane: entry?.focusedPane ?? 0,
    orientation: entry?.orientation ?? "horizontal",
    activeGroup: panes.length > 1 ? (entry?.group ?? null) : null,
  };
}

function nextFill(used: Set<string>, preferredKey?: string | null): string | null {
  if (preferredKey && !used.has(preferredKey)) return preferredKey;
  const unused = useTableTabs.getState().tabs.find((tab) => !used.has(tabKey(tab)));
  return unused ? tabKey(unused) : null;
}

export const useSplitView = create<SplitState>()(
  persist(
    (set, get) => ({
      panes: [],
      masters: [],
      focusedPane: 0,
      orientation: "horizontal",
      activeGroup: null,
      groups: {},
      openGroup: (id) => {
        const state = get();
        const scope = keyForConnection(useConnectionsStore.getState().activeId);
        const group = state.groups[scope]?.find((entry) => entry.id === id);
        if (!group) return null;
        const open = new Set(useTableTabs.getState().tabs.map(tabKey));
        const missing = group.tabs.filter(
          (tab): tab is Tab => tab != null && !tab.connectionId && !open.has(tabKey(tab)),
        );
        if (missing.length > 0)
          useTableTabs.setState((tabs) => storeFor([...tabs.tabs, ...missing], tabs));
        const panes = group.tabs.map((tab) => (tab ? tabKey(tab) : null));
        const focusedPane = Math.min(group.focusedPane, panes.length - 1);
        set((current) => ({
          ...snapshot(
            panes,
            focusedPane,
            { ...current, orientation: group.orientation, activeGroup: id },
            normalizeMasters(group.masters, panes.length),
          ),
          orientation: group.orientation,
        }));
        const local = group.tabs.filter((tab): tab is Tab => tab != null && !tab.connectionId);
        const focused = group.tabs[focusedPane];
        return focused && !focused.connectionId ? focused : (local[0] ?? null);
      },
      renameGroup: (id, name) =>
        set((state) => {
          const scope = keyForConnection(useConnectionsStore.getState().activeId);
          const trimmed = name.trim();
          if (!trimmed) return state;
          return {
            groups: {
              ...state.groups,
              [scope]: (state.groups[scope] ?? []).map((group) =>
                group.id === id ? { ...group, name: trimmed } : group,
              ),
            },
          };
        }),
      deleteGroup: (id) =>
        set((state) => {
          const scope = keyForConnection(useConnectionsStore.getState().activeId);
          const groups = {
            ...state.groups,
            [scope]: (state.groups[scope] ?? []).filter((group) => group.id !== id),
          };
          if (state.activeGroup !== id) return { groups };
          return snapshot([], 0, { ...state, groups, activeGroup: null }, []);
        }),
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
          return snapshot([], 0, state, []);
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

      setPaneTab: (index, connectionId, tab) =>
        set((state) => {
          if (index < 0 || index >= state.panes.length) return state;
          const key = tab ? tabKey({ ...tab, connectionId: connectionId ?? undefined }) : null;
          const existing = key ? state.panes.indexOf(key) : -1;
          if (existing !== -1 && existing !== index) return snapshot(state.panes, existing, state);
          const scope = keyForConnection(useConnectionsStore.getState().activeId);
          const paneConnections = { ...state.paneConnections };
          for (const stale of [key, state.panes[index], `split-detail:${index}`]) {
            delete paneConnections[`${scope}|${stale}`];
          }
          const panes = [...state.panes];
          panes[index] = key;
          return { ...snapshot(panes, index, state), paneConnections };
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
          const panes = state.panes.map((key) =>
            key && (validKeys.has(key) || remoteTab(key)) ? key : null,
          );
          if (panes.every((key, i) => key === state.panes[i])) return state;
          return snapshot([], 0, state, []);
        }),

      clearForConnection: (connectionId) =>
        set((state) => {
          const byConnection = { ...state.byConnection };
          delete byConnection[connectionId];
          const groups = { ...state.groups };
          delete groups[connectionId];
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
              activeGroup: null,
              byConnection,
              groups,
              paneConnections,
            };
          }
          return { byConnection, groups, paneConnections };
        }),
    }),
    {
      name: "l8db.split-view",
      storage: createChangedOnlyJsonStorage(),
      partialize: (state) => ({
        byConnection: state.byConnection,
        paneConnections: state.paneConnections,
        groups: state.groups,
      }),
      merge: (persistedState, currentState) => {
        const stored = persistedState as Partial<SplitState> | undefined;
        const byConnection = stored?.byConnection ?? {};
        const key = keyForConnection(useConnectionsStore.getState().activeId);
        return {
          ...currentState,
          byConnection,
          paneConnections: stored?.paneConnections ?? {},
          groups: stored?.groups ?? {},
          ...restore(byConnection[key]),
        };
      },
    },
  ),
);

export function usePaneTabs(): (Tab | undefined)[] {
  const panes = useSplitView((state) => state.panes);
  const tabs = useTableTabs((state) => state.tabs);
  const connections = useConnectionsStore((state) => state.connections);
  return panes.map((key) => {
    const remote = remoteTab(key);
    if (!remote) return tabs.find((tab) => tabKey(tab) === key);
    return connections.some((entry) => entry.id === remote.connectionId) ? remote : undefined;
  });
}

const NO_GROUPS: SplitGroup[] = [];

export function useSplitGroups(): SplitGroup[] {
  const scope = keyForConnection(useConnectionsStore((state) => state.activeId));
  return useSplitView((state) => state.groups[scope]) ?? NO_GROUPS;
}

export function usePaneConnectionId(key: string | null): string | null {
  const activeId = useConnectionsStore((state) => state.activeId);
  const connections = useConnectionsStore((state) => state.connections);
  const override = useSplitView((state) =>
    key
      ? (remoteTab(key)?.connectionId ??
        state.paneConnections[`${keyForConnection(activeId)}|${key}`] ??
        null)
      : null,
  );
  if (!override || override === activeId) return null;
  return connections.some((entry) => entry.id === override) ? override : null;
}

export function useFocusedPaneScope(): { index: number; connectionId: string } | null {
  const index = useSplitView((state) => (state.panes.length > 1 ? state.focusedPane : -1));
  const tab = usePaneTabs()[index];
  const connectionId = usePaneConnectionId(
    index === -1 ? null : tab ? tabKey(tab) : `split-detail:${index}`,
  );
  return connectionId ? { index, connectionId } : null;
}

syncAcrossWindows("l8db.split-view", (value) => {
  try {
    const groups: Record<string, SplitGroup[]> | null = value
      ? JSON.parse(value)?.state?.groups
      : null;
    if (!groups) return;
    const { activeGroup } = useSplitView.getState();
    const scope = keyForConnection(useConnectionsStore.getState().activeId);
    useSplitView.setState({ groups });
    if (activeGroup && !groups[scope]?.some((group) => group.id === activeGroup))
      useSplitView.setState((state) => snapshot([], 0, state, []));
  } catch {}
});

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
  rememberClosedGroupTabs(previous.tabs, state.tabs);
  useSplitView.getState().prune(new Set(state.tabs.map(tabKey)));
});

function rememberClosedGroupTabs(previous: Tab[], current: Tab[]) {
  if (previous.length <= current.length) return;
  const open = new Set(current.map(tabKey));
  const closed = new Map(
    previous.filter((tab) => !open.has(tabKey(tab))).map((tab) => [tabKey(tab), tab]),
  );
  if (closed.size === 0) return;
  const scope = keyForConnection(useConnectionsStore.getState().activeId);
  const { groups } = useSplitView.getState();
  const list = groups[scope];
  if (!list?.some((group) => group.tabs.some((tab) => tab && closed.has(tabKey(tab))))) return;
  useSplitView.setState({
    groups: {
      ...groups,
      [scope]: list.map((group) => ({
        ...group,
        tabs: group.tabs.map((tab) => (tab ? (closed.get(tabKey(tab)) ?? tab) : tab)),
      })),
    },
  });
}
