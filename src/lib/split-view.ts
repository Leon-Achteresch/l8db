import { useMemo, useRef } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createChangedOnlyJsonStorage } from "@/lib/buffered-storage";
import { useConnectionsStore } from "@/lib/connections";
import { recentTabKeys } from "@/lib/recent-tabs";
import {
  autoLayout,
  edgeAxis,
  isSplitTree,
  leafCount,
  type SplitEdge,
  type SplitOrientation,
  type SplitTree,
  transposeLayout,
} from "@/lib/split-layout";
import { isAncestor, normalizeMasters, type PaneMasters } from "@/lib/split-links";
import {
  addTabs,
  closePane,
  MAX_SPLIT_PANES,
  moveTab,
  normalizeWorkspace,
  type PaneWorkspace,
  paneOf,
  removeTabs,
  revealTab,
  singlePane,
  splitPane,
  swapPanes,
} from "@/lib/split-panes";
import { remoteTab, sameTabBarTabs, type Tab, tabKey, useTableTabs } from "@/lib/table-tabs";
import { storeFor } from "@/lib/table-tabs/helpers";
import { uiPluginRegistry } from "@/lib/ui-plugins/store";
import { syncAcrossWindows } from "@/lib/window-sync";

export type { SplitOrientation };
export { MAX_SPLIT_PANES };

export const MAX_SPLIT_GROUPS = 50;

const DEFAULT_GROUP_NAME = /^Ansicht \d+$/;

const NONE_KEY = "__none__";

function keyForConnection(id: string | null | undefined): string {
  return id ?? NONE_KEY;
}

function scopeKey(): string {
  return keyForConnection(useConnectionsStore.getState().activeId);
}

export type SplitSnapshot = {
  orientation?: SplitOrientation;
  panes: (string | null)[];
  paneTabs?: string[][];
  layout?: SplitTree;
  masters?: PaneMasters;
  focusedPane: number;
  group?: string | null;
  version?: number;
};

export type SplitGroup = {
  id: string;
  name: string;
  tabs: (Tab | null)[];
  masters: PaneMasters;
  orientation: SplitOrientation;
  focusedPane: number;
  layout?: SplitTree;
  shared?: boolean;
};

type Live = Pick<SplitState, "panes" | "paneTabs" | "layout" | "masters" | "focusedPane">;

const SINGLE: Live = { panes: [], paneTabs: [], layout: null, masters: [], focusedPane: 0 };
const SNAPSHOT_VERSION = 2;
const groupTabs = new Map<string, string[][]>();
let detaching = false;

function liveOf(state: Live): Live {
  return {
    panes: state.panes,
    paneTabs: state.paneTabs,
    layout: state.layout,
    masters: state.masters,
    focusedPane: state.focusedPane,
  };
}

interface SplitState {
  orientation: SplitOrientation;
  setOrientation: (orientation: SplitOrientation) => void;
  panes: (string | null)[];
  paneTabs: string[][];
  layout: SplitTree;
  masters: PaneMasters;
  setMaster: (detail: number, master: number | null) => void;
  focusedPane: number;
  away: boolean;
  showSplit: () => void;
  activeGroup: string | null;
  groups: Record<string, SplitGroup[]>;
  openGroup: (id: string) => Tab | null;
  renameGroup: (id: string, name: string) => void;
  setGroupShared: (id: string, shared: boolean, connectionId?: string) => void;
  deleteGroup: (id: string, connectionId?: string) => void;
  byConnection: Record<string, SplitSnapshot>;
  paneConnections: Record<string, string>;
  setPaneConnection: (tabKey: string, connectionId: string | null) => void;
  split: (options: {
    activeKey: string | null;
    key?: string | null;
    target?: number;
    edge?: SplitEdge;
  }) => void;
  moveTab: (key: string, to: number, at?: number) => void;
  detach: (key: string, before?: string | null) => void;
  removeTab: (key: string) => void;
  closePane: (index: number) => string | null;
  collapse: () => void;
  focusPane: (index: number) => void;
  reveal: (key: string) => void;
  setPane: (index: number, key: string) => void;
  setPaneTab: (index: number, connectionId: string | null, tab: Tab | null) => void;
  swapPanes: (from: number, to: number) => void;
  syncTabs: (open: string[], added?: string[]) => void;
  clearForConnection: (connectionId: string) => void;
}

function openKeys(): string[] {
  return useTableTabs.getState().tabs.map(tabKey);
}

function keepKey(key: string): boolean {
  return remoteTab(key) !== null;
}

export function isBoundToSplit(state: Pick<SplitState, "paneConnections">, key: string): boolean {
  return keepKey(key) || Boolean(state.paneConnections[`${scopeKey()}|${key}`]);
}

function placeable(ws: PaneWorkspace, key: string): boolean {
  return paneOf(ws, key) !== -1 || openKeys().includes(key);
}

function pluginLayout(count: number, orientation: SplitOrientation): SplitTree {
  return autoLayout(count, orientation, uiPluginRegistry().splitLayout);
}

function storedLayout(layout: unknown, count: number): SplitTree {
  return layout && isSplitTree(layout) && leafCount(layout) === count ? layout : null;
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
  live: Live,
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
            tabs: live.panes.map((key) => paneTab(key, group.tabs)),
            masters: live.masters,
            focusedPane: live.focusedPane,
            orientation: state.orientation,
            layout: live.layout,
          }
        : group,
    ),
  };
}

function ensureGroup(
  state: Pick<SplitState, "groups" | "activeGroup" | "orientation">,
  scope: string,
  live: Live,
): Pick<SplitState, "groups" | "activeGroup"> & { adopted: SplitGroup | null } {
  const existing = state.groups[scope] ?? [];
  if (state.activeGroup && existing.some((group) => group.id === state.activeGroup))
    return { groups: state.groups, activeGroup: state.activeGroup, adopted: null };
  const keys = live.panes.join("\0");
  const same = existing.find(
    (group) => group.tabs.map((tab) => (tab ? tabKey(tab) : "")).join("\0") === keys,
  );
  if (same) return { groups: state.groups, activeGroup: same.id, adopted: same };
  if (!uiPluginRegistry().autoSaveGroups)
    return { groups: state.groups, activeGroup: null, adopted: null };
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
    tabs: live.panes.map((key) => paneTab(key, [])),
    masters: live.masters,
    orientation: state.orientation,
    focusedPane: live.focusedPane,
    layout: live.layout,
  };
  return {
    groups: { ...state.groups, [scope]: [...list, group] },
    activeGroup: group.id,
    adopted: null,
  };
}

function snapshot(
  live: Live,
  state: Pick<SplitState, "byConnection" | "orientation" | "groups" | "activeGroup">,
): Partial<SplitState> {
  const scope = scopeKey();
  const split = live.panes.length > 1;
  const grouped = split
    ? ensureGroup(state, scope, live)
    : { groups: state.groups, activeGroup: null, adopted: null };
  const { adopted } = grouped;
  const masters = adopted ? normalizeMasters(adopted.masters, live.panes.length) : live.masters;
  const restyle = adopted !== null && live.layout === null;
  const orientation = restyle ? adopted.orientation : state.orientation;
  const layout = restyle ? storedLayout(adopted.layout, live.panes.length) : live.layout;
  const next = { ...live, masters, layout };
  if (split && grouped.activeGroup) groupTabs.set(grouped.activeGroup, next.paneTabs);
  return {
    ...next,
    orientation,
    activeGroup: grouped.activeGroup,
    groups: split
      ? syncedGroups(
          { groups: grouped.groups, activeGroup: grouped.activeGroup, orientation },
          scope,
          next,
        )
      : state.groups,
    byConnection: {
      ...state.byConnection,
      [scope]: {
        panes: next.panes,
        paneTabs: next.paneTabs,
        layout: next.layout,
        masters,
        focusedPane: next.focusedPane,
        orientation,
        group: grouped.activeGroup,
        version: SNAPSHOT_VERSION,
      },
    },
  };
}

function restore(
  entry: SplitSnapshot | undefined,
  paneConnections: Record<string, string>,
): Live & Pick<SplitState, "orientation" | "activeGroup" | "away"> {
  const orientation = entry?.orientation ?? "horizontal";
  const current =
    entry?.version === SNAPSHOT_VERSION
      ? entry
      : entry && {
          ...entry,
          paneTabs:
            entry.paneTabs?.map((tabs, index) =>
              tabs.filter(
                (key) => key === entry.panes[index] || isBoundToSplit({ paneConnections }, key),
              ),
            ) ?? [],
        };
  const ws = current
    ? normalizeWorkspace(current, openKeys(), keepKey, (count) => pluginLayout(count, orientation))
    : null;
  if (!ws) return { ...SINGLE, orientation, activeGroup: null, away: true };
  return {
    ...ws,
    layout: storedLayout(entry?.layout, ws.panes.length) ? ws.layout : null,
    orientation,
    activeGroup: entry?.group ?? null,
    away: true,
  };
}

function workspace(state: SplitState): PaneWorkspace {
  return {
    panes: state.panes,
    paneTabs: state.paneTabs,
    masters: state.masters,
    layout: state.layout ?? pluginLayout(state.panes.length, state.orientation),
    focusedPane: state.focusedPane,
  };
}

export function placeOpenTab(key: string, before: string | null) {
  const { tabs } = useTableTabs.getState();
  const tab = tabs.find((entry) => tabKey(entry) === key);
  if (!tab) return;
  const rest = tabs.filter((entry) => entry !== tab);
  const found = before === null ? -1 : rest.findIndex((entry) => tabKey(entry) === before);
  const at = found === -1 ? rest.length : found;
  const next = [...rest.slice(0, at), tab, ...rest.slice(at)];
  if (next.every((entry, index) => entry === tabs[index])) return;
  useTableTabs.setState((state) => storeFor(next, state));
}

function reorderOpenTabs(order: string[]) {
  const { tabs } = useTableTabs.getState();
  const rank = new Map(order.map((key, index) => [key, index]));
  const sorted = [...tabs].sort(
    (a, b) => (rank.get(tabKey(a)) ?? order.length) - (rank.get(tabKey(b)) ?? order.length),
  );
  if (sorted.every((tab, index) => tab === tabs[index])) return;
  useTableTabs.setState((state) => storeFor(sorted, state));
}

export const useSplitView = create<SplitState>()(
  persist(
    (set, get) => {
      const apply = (
        next: PaneWorkspace,
        options: { explicit?: boolean; orientation?: SplitOrientation } = {},
      ) => {
        const state = get();
        const orientation = options.orientation ?? state.orientation;
        if (next.panes.length < 2) {
          set(snapshot(SINGLE, { ...state, orientation }));
          reorderOpenTabs(next.paneTabs.flat());
          return;
        }
        const layout = options.explicit || state.layout ? next.layout : null;
        set(snapshot({ ...next, layout }, { ...state, orientation }));
      };
      const change = (operation: (ws: PaneWorkspace) => PaneWorkspace) => {
        const state = get();
        if (state.panes.length < 2) return;
        const ws = workspace(state);
        const next = operation(ws);
        if (next !== ws) apply(next);
      };

      return {
        panes: [],
        paneTabs: [],
        layout: null,
        masters: [],
        focusedPane: 0,
        away: true,
        orientation: "horizontal",
        activeGroup: null,
        groups: {},
        byConnection: {},
        paneConnections: {},

        showSplit: () => {
          if (get().away) set({ away: false });
        },

        openGroup: (id) => {
          const scope = scopeKey();
          const group = get().groups[scope]?.find((entry) => entry.id === id);
          if (!group) return null;
          const open = new Set(openKeys());
          const missing = group.tabs.filter(
            (tab): tab is Tab => tab != null && !tab.connectionId && !open.has(tabKey(tab)),
          );
          if (missing.length > 0)
            openDetached(() =>
              useTableTabs.setState((tabs) => storeFor([...tabs.tabs, ...missing], tabs)),
            );
          const panes = group.tabs.map((tab) => (tab ? tabKey(tab) : null));
          const ws = normalizeWorkspace(
            {
              panes,
              paneTabs: groupTabs.get(id),
              masters: group.masters,
              layout: group.layout,
              focusedPane: Math.min(group.focusedPane, panes.length - 1),
            },
            openKeys(),
            keepKey,
            (count) => pluginLayout(count, group.orientation),
          );
          if (!ws) return null;
          set((current) => ({
            ...snapshot(
              { ...ws, layout: storedLayout(group.layout, ws.panes.length) ? ws.layout : null },
              { ...current, orientation: group.orientation, activeGroup: id },
            ),
            away: false,
          }));
          const local = group.tabs.filter((tab): tab is Tab => tab != null && !tab.connectionId);
          const focused = group.tabs[ws.focusedPane];
          return focused && !focused.connectionId ? focused : (local[0] ?? null);
        },
        renameGroup: (id, name) =>
          set((state) => {
            const scope = scopeKey();
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
        setGroupShared: (id, shared, connectionId) =>
          set((state) => {
            const scope = connectionId ?? scopeKey();
            return {
              groups: {
                ...state.groups,
                [scope]: (state.groups[scope] ?? []).map((group) =>
                  group.id === id ? { ...group, shared } : group,
                ),
              },
            };
          }),
        deleteGroup: (id, connectionId) => {
          const state = get();
          const scope = connectionId ?? scopeKey();
          const groups = {
            ...state.groups,
            [scope]: (state.groups[scope] ?? []).filter((group) => group.id !== id),
          };
          if (state.activeGroup !== id || scope !== scopeKey()) {
            set({ groups });
            return;
          }
          set(snapshot(SINGLE, { ...state, groups, activeGroup: null }));
          reorderOpenTabs(state.paneTabs.flat());
        },
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
            return snapshot({ ...liveOf(state), masters }, state);
          }),
        setOrientation: (orientation) => {
          const state = get();
          if (state.orientation === orientation) return;
          if (state.panes.length < 2) {
            set(snapshot(SINGLE, { ...state, orientation }));
            return;
          }
          const ws = workspace(state);
          const explicit = state.layout !== null || state.panes.length > 2;
          apply(
            { ...ws, layout: explicit ? transposeLayout(ws.layout) : ws.layout },
            { explicit, orientation },
          );
        },

        setPaneConnection: (key, connectionId) =>
          set((state) => {
            const scoped = `${scopeKey()}|${key}`;
            const paneConnections = { ...state.paneConnections };
            if (connectionId) paneConnections[scoped] = connectionId;
            else delete paneConnections[scoped];
            return { paneConnections };
          }),

        split: ({ activeKey, key = null, target, edge }) => {
          const state = get();
          const single = state.panes.length < 2;
          const seed = activeKey && activeKey !== key ? activeKey : null;
          const ws = single ? singlePane(seed ? [seed] : [], seed) : workspace(state);
          if (key && !placeable(ws, key)) return;
          const orientation =
            single && edge
              ? edgeAxis(edge) === "row"
                ? "horizontal"
                : "vertical"
              : state.orientation;
          const auto = !edge && (single || !state.layout);
          const next = splitPane(ws, {
            key,
            target: single ? 0 : (target ?? state.focusedPane),
            edge: edge ?? "right",
            recent: recentTabKeys(),
            layout: auto ? (count) => pluginLayout(count, orientation) : undefined,
          });
          if (next === ws || next.panes.length < 2) return;
          apply(next, { explicit: !auto, orientation });
          set({ away: false });
        },

        moveTab: (key, to, at) =>
          change((ws) => (placeable(ws, key) ? moveTab(ws, key, to, at, recentTabKeys()) : ws)),

        detach: (key, before) => {
          const state = get();
          if (isBoundToSplit(state, key) || !openKeys().includes(key)) return;
          if (state.panes.length > 1)
            change((ws) =>
              paneOf(ws, key) === -1
                ? ws
                : removeTabs(ws, (entry) => entry === key, recentTabKeys()),
            );
          if (before === undefined) reorderOpenTabs([key]);
          else placeOpenTab(key, before);
        },

        removeTab: (key) =>
          change((ws) => removeTabs(ws, (entry) => entry === key, recentTabKeys())),

        closePane: (index) => {
          const state = get();
          if (state.panes.length < 2 || !state.paneTabs[index]) return null;
          const next = closePane(workspace(state), index, (key) => isBoundToSplit(state, key));
          reorderOpenTabs(state.paneTabs[index]);
          apply(next);
          return next.panes[next.focusedPane] ?? null;
        },

        collapse: () => {
          const state = get();
          set(snapshot(SINGLE, state));
          reorderOpenTabs(state.paneTabs.flat());
        },

        focusPane: (index) =>
          set((state) => {
            if (index < 0 || index >= state.panes.length || index === state.focusedPane)
              return state;
            return snapshot({ ...liveOf(state), focusedPane: index }, state);
          }),

        reveal: (key) => {
          const state = get();
          if (!key || state.panes.length < 2) return;
          const away = !state.paneTabs.some((tabs) => tabs.includes(key)) && !keepKey(key);
          if (!away) change((ws) => revealTab(ws, key));
          if (get().away !== away && (!away || openKeys().includes(key))) set({ away });
        },

        setPane: (index, key) =>
          change((ws) => moveTab(ws, key, index, undefined, recentTabKeys())),

        setPaneTab: (index, connectionId, tab) => {
          const state = get();
          if (index < 0 || index >= state.panes.length) return;
          const key = tab ? tabKey({ ...tab, connectionId: connectionId ?? undefined }) : null;
          const scope = scopeKey();
          const paneConnections = { ...state.paneConnections };
          for (const stale of [key, `split-detail:${index}`]) {
            delete paneConnections[`${scope}|${stale}`];
          }
          set({ paneConnections });
          change((ws) => {
            if (!key)
              return {
                ...ws,
                panes: ws.panes.map((entry, i) => (i === index ? null : entry)),
                focusedPane: index,
              };
            const found = paneOf(ws, key);
            if (found !== -1 && found !== index) return revealTab(ws, key);
            const list = ws.paneTabs[index];
            const active = ws.panes[index];
            const at = found === index || !active ? undefined : list.indexOf(active) + 1;
            return moveTab(ws, key, index, at, recentTabKeys());
          });
        },

        swapPanes: (from, to) => change((ws) => swapPanes(ws, from, to)),

        syncTabs: (open, added = []) =>
          change((ws) => {
            const keys = new Set(open);
            const gone = (key: string) => !keys.has(key) && !keepKey(key);
            const kept = ws.paneTabs.some((list) => list.some(gone))
              ? removeTabs(ws, gone, recentTabKeys())
              : ws;
            if (get().away || detaching) return kept;
            return addTabs(kept, added, uiPluginRegistry().newTabPosition === "afterActive");
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
            if (scopeKey() === connectionId) {
              return {
                ...SINGLE,
                away: true,
                orientation: "horizontal",
                activeGroup: null,
                byConnection,
                groups,
                paneConnections,
              };
            }
            return { byConnection, groups, paneConnections };
          }),
      };
    },
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
        return {
          ...currentState,
          byConnection,
          paneConnections: stored?.paneConnections ?? {},
          groups: stored?.groups ?? {},
          ...restore(byConnection[scopeKey()], stored?.paneConnections ?? {}),
        };
      },
    },
  ),
);

export function openDetached<T>(open: () => T): T {
  const previous = detaching;
  detaching = true;
  try {
    return open();
  } finally {
    detaching = previous;
  }
}

export function isSplitShown(
  state: Pick<SplitState, "panes" | "paneTabs" | "away">,
  routeKey: string | null,
): boolean {
  if (state.panes.length < 2 || !routeKey) return false;
  return !state.away || state.paneTabs.some((tabs) => tabs.includes(routeKey));
}

export function useSplitShown(routeKey: string | null): boolean {
  return useSplitView((state) => isSplitShown(state, routeKey));
}

export function standaloneTabs<T extends Tab>(tabs: T[], paneTabs: string[][]): T[] {
  if (paneTabs.length < 2) return tabs;
  const inSplit = new Set(paneTabs.flat());
  return tabs.filter((tab) => !inSplit.has(tabKey(tab)));
}

export function tabAfterClose(closing: Set<string>): string | null {
  const state = useSplitView.getState();
  if (state.panes.length < 2) return null;
  const ws = removeTabs(workspace(state), (key) => closing.has(key), recentTabKeys());
  const open = new Set(openKeys());
  const local = (key: string | null): key is string =>
    Boolean(key && open.has(key) && !closing.has(key));
  const focused = ws.panes[ws.focusedPane] ?? null;
  return local(focused) ? focused : (ws.panes.find(local) ?? null);
}

function resolveTab(
  key: string | null,
  tabs: Map<string, Tab>,
  connections: { id: string }[],
): Tab | undefined {
  if (!key) return undefined;
  const remote = remoteTab(key);
  if (!remote) return tabs.get(key);
  return connections.some((entry) => entry.id === remote.connectionId) ? remote : undefined;
}

export function usePaneTabs(): (Tab | undefined)[] {
  const panes = useSplitView((state) => state.panes);
  const tabs = useTableTabs((state) => state.tabs);
  const connections = useConnectionsStore((state) => state.connections);
  const byKey = useMemo(() => new Map(tabs.map((tab) => [tabKey(tab), tab])), [tabs]);
  return panes.map((key) => resolveTab(key, byKey, connections));
}

const NO_KEYS: string[] = [];

export function usePaneTabList(index: number): Tab[] {
  const keys = useSplitView((state) => state.paneTabs[index] ?? NO_KEYS);
  const shown = useRef<Tab[]>([]);
  const tabs = useTableTabs((state) => {
    if (!sameTabBarTabs(shown.current, state.tabs)) shown.current = state.tabs;
    return shown.current;
  });
  const connections = useConnectionsStore((state) => state.connections);
  return useMemo(() => {
    const byKey = new Map(tabs.map((tab) => [tabKey(tab), tab]));
    return keys.flatMap((key) => resolveTab(key, byKey, connections) ?? []);
  }, [keys, tabs, connections]);
}

const NO_GROUPS: SplitGroup[] = [];

export type ForeignSplitGroup = { connectionId: string; connectionName: string; group: SplitGroup };

export function foreignSplitGroups(
  groups: Record<string, SplitGroup[]>,
  activeId: string | null,
  connections: readonly { id: string; name: string }[],
): ForeignSplitGroup[] {
  return connections.flatMap((connection) =>
    connection.id === activeId
      ? []
      : (groups[connection.id] ?? [])
          .filter((group) => group.shared)
          .map((group) => ({
            connectionId: connection.id,
            connectionName: connection.name,
            group,
          })),
  );
}

export function useForeignSplitGroups(): ForeignSplitGroup[] {
  const groups = useSplitView((state) => state.groups);
  const activeId = useConnectionsStore((state) => state.activeId);
  const connections = useConnectionsStore((state) => state.connections);
  return useMemo(
    () => foreignSplitGroups(groups, activeId, connections),
    [groups, activeId, connections],
  );
}

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
    useSplitView.setState({ groups });
    if (activeGroup && !groups[scopeKey()]?.some((group) => group.id === activeGroup))
      useSplitView.getState().collapse();
  } catch {}
});

let splitConnectionId = useConnectionsStore.getState().activeId;

useConnectionsStore.subscribe((state, previous) => {
  if (state.activeId === previous.activeId) return;
  splitConnectionId = state.activeId;
  useSplitView.setState(
    restore(
      useSplitView.getState().byConnection[keyForConnection(state.activeId)],
      useSplitView.getState().paneConnections,
    ),
  );
});

useTableTabs.subscribe((state, previous) => {
  if (state.tabs === previous.tabs) return;
  if (splitConnectionId !== useConnectionsStore.getState().activeId) return;
  rememberClosedGroupTabs(previous.tabs, state.tabs);
  if (sameKeys(previous.tabs, state.tabs)) return;
  const before = new Set(previous.tabs.map(tabKey));
  const open = state.tabs.map(tabKey);
  useSplitView.getState().syncTabs(
    open,
    open.filter((key) => !before.has(key)),
  );
});

function sameKeys(previous: Tab[], current: Tab[]) {
  return (
    previous.length === current.length &&
    current.every(
      (tab, index) => tab === previous[index] || tabKey(tab) === tabKey(previous[index]),
    )
  );
}

function rememberClosedGroupTabs(previous: Tab[], current: Tab[]) {
  if (previous.length <= current.length) return;
  const open = new Set(current.map(tabKey));
  const closed = new Map(
    previous.filter((tab) => !open.has(tabKey(tab))).map((tab) => [tabKey(tab), tab]),
  );
  if (closed.size === 0) return;
  const scope = scopeKey();
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
