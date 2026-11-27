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
  paneTabs?: Tab[][];
  origin?: string;
};

type Live = Pick<SplitState, "panes" | "paneTabs" | "layout" | "masters" | "focusedPane">;

const SINGLE: Live = { panes: [], paneTabs: [], layout: null, masters: [], focusedPane: 0 };
const SNAPSHOT_VERSION = 2;
let detaching = false;
let liveSource: Tab[] | null = null;
let liveByKey = new Map<string, Tab>();

function liveTabs(): Map<string, Tab> {
  const { tabs } = useTableTabs.getState();
  if (tabs !== liveSource) {
    liveSource = tabs;
    liveByKey = new Map(tabs.map((tab) => [tabKey(tab), tab]));
  }
  return liveByKey;
}

export function groupPaneTabs(group: Pick<SplitGroup, "tabs" | "paneTabs">): Tab[][] {
  return group.paneTabs ?? group.tabs.map((tab) => (tab ? [tab] : []));
}

export function isTabSet(group: Pick<SplitGroup, "tabs">): boolean {
  return group.tabs.length < 2;
}

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
  closedTabs: Record<string, Record<string, Tab>>;
  openGroup: (id: string) => Tab | null;
  saveTabs: (activeKey: string | null, id?: string) => string | null;
  adoptGroup: (id: string, connectionId: string) => string | null;
  retargetGroup: (id: string, schemas: ReadonlyMap<string, string>) => void;
  renameGroup: (id: string, name: string) => void;
  setGroupShared: (id: string, shared: boolean, connectionId?: string) => void;
  deleteGroup: (id: string, connectionId?: string) => void;
  openGroups: Record<string, string[]>;
  closeView: (id: string) => void;
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

function storedLayout(layout: unknown, count: number): SplitTree {
  return layout && isSplitTree(layout) && leafCount(layout) === count ? layout : null;
}

function queryStub(tab: { id: string; title: string }): Extract<Tab, { kind: "query" }> {
  return { kind: "query", id: tab.id, title: tab.title, sql: "" };
}

function tabResolver(group?: SplitGroup): (key: string | null) => Tab | null {
  const live = liveTabs();
  let previous: Map<string, Tab> | undefined;
  return (key) => {
    if (!key) return null;
    const tab = live.get(key);
    if (tab?.kind === "query") return queryStub(tab);
    const remote = remoteTab(key) ?? tab;
    if (remote || !group) return remote ?? null;
    previous ??= new Map(
      [...group.tabs, ...groupPaneTabs(group).flat()].flatMap((entry) =>
        entry ? [[tabKey(entry), entry] as const] : [],
      ),
    );
    return previous.get(key) ?? null;
  };
}

function storedPaneTabs(
  paneTabs: string[][],
  resolve: (key: string | null) => Tab | null,
): Tab[][] | undefined {
  if (paneTabs.every((keys) => keys.length < 2)) return undefined;
  return paneTabs.map((keys) => keys.flatMap((key) => resolve(key) ?? []));
}

function isWorkbench(tab: Tab): boolean {
  return tab.kind === "tool" && tab.tool === "workbench";
}

function keepsContent(tab: Tab | null | undefined): tab is Tab {
  return tab?.kind === "query" || (tab?.kind === "tool" && !isWorkbench(tab));
}

function ownTab(tab: Tab): Tab {
  const { connectionId: _, ...own } = tab;
  return own as Tab;
}

function groupsPatch(
  state: Pick<SplitState, "groups" | "closedTabs">,
  scope: string,
  list: SplitGroup[],
  closed = state.closedTabs[scope],
): Pick<SplitState, "groups" | "closedTabs"> {
  return {
    groups: { ...state.groups, [scope]: list },
    closedTabs: closed
      ? { ...state.closedTabs, [scope]: usedCopies(closed, list) }
      : state.closedTabs,
  };
}

function portable(tab: Tab): boolean {
  return (
    tab.kind !== "function" &&
    tab.kind !== "procedure" &&
    !(tab.kind === "tool" && tab.id !== undefined)
  );
}

function evictable(
  list: SplitGroup[],
  activeGroup: string | null,
): { list: SplitGroup[]; full: boolean } {
  if (list.length < MAX_SPLIT_GROUPS) return { list, full: false };
  const stale = list.find(
    (group) => group.id !== activeGroup && DEFAULT_GROUP_NAME.test(group.name),
  );
  return { list: stale ? list.filter((group) => group !== stale) : list, full: !stale };
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
    [scope]: list.map((group) => {
      if (group.id !== state.activeGroup) return group;
      const resolve = tabResolver(group);
      return {
        ...group,
        tabs: live.panes.map(resolve),
        paneTabs: storedPaneTabs(live.paneTabs, resolve),
        masters: live.masters,
        focusedPane: live.focusedPane,
        orientation: state.orientation,
        layout: live.layout,
      };
    }),
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
    (group) =>
      group.tabs.map((tab) => (tab ? tabKey(tab) : "")).join("\0") === keys &&
      (!group.paneTabs ||
        group.paneTabs.every(
          (tabs, pane) =>
            tabs.length === live.paneTabs[pane]?.length &&
            tabs.every((tab, index) => tabKey(tab) === live.paneTabs[pane][index]),
        )),
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
    tabs: live.panes.map(tabResolver()),
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

function withOpen(
  openGroups: Record<string, string[]>,
  scope: string,
  id: string | null,
  groups: SplitGroup[] = [],
): Record<string, string[]> {
  const list = openGroups[scope] ?? [];
  if (!id || list.includes(id)) return openGroups;
  const known = new Set(groups.map((group) => group.id));
  return { ...openGroups, [scope]: [...list.filter((entry) => known.has(entry)), id] };
}

function withoutOpen(
  openGroups: Record<string, string[]>,
  scope: string,
  id: string | null,
): Record<string, string[]> {
  const list = openGroups[scope];
  if (!id || !list?.includes(id)) return openGroups;
  return { ...openGroups, [scope]: list.filter((entry) => entry !== id) };
}

function snapshot(
  live: Live,
  state: Pick<SplitState, "byConnection" | "orientation" | "groups" | "activeGroup" | "openGroups">,
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
  return {
    ...next,
    orientation,
    activeGroup: grouped.activeGroup,
    openGroups: split
      ? withOpen(state.openGroups, scope, grouped.activeGroup, grouped.groups[scope])
      : state.openGroups,
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
    ? normalizeWorkspace(current, openKeys(), keepKey, (count) => autoLayout(count, orientation))
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
    layout: state.layout ?? autoLayout(state.panes.length, state.orientation),
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
        openGroups: {},
        closedTabs: {},
        byConnection: {},
        paneConnections: {},

        showSplit: () => {
          if (get().away) set({ away: false });
        },

        openGroup: (id) => {
          const scope = scopeKey();
          const group = get().groups[scope]?.find((entry) => entry.id === id);
          if (!group) return null;
          const lists = groupPaneTabs(group);
          const open = liveTabs();
          const closed = get().closedTabs[scope];
          const missing = new Map<string, Tab>();
          for (const tab of lists.flat()) {
            const key = tabKey(tab);
            if (!tab.connectionId && !open.has(key) && !isWorkbench(tab))
              missing.set(key, closed?.[key] ?? tab);
          }
          if (missing.size > 0)
            openDetached(() =>
              useTableTabs.setState((tabs) => storeFor([...tabs.tabs, ...missing.values()], tabs)),
            );
          const local = lists.flat().filter((tab) => !tab.connectionId);
          if (isTabSet(group)) {
            const first = group.tabs[0] ?? local[0] ?? null;
            if (first) get().reveal(tabKey(first));
            return first;
          }
          const panes = group.tabs.map((tab) => (tab ? tabKey(tab) : null));
          const ws = normalizeWorkspace(
            {
              panes,
              paneTabs: group.paneTabs?.map((tabs) => tabs.map(tabKey)),
              masters: group.masters,
              layout: group.layout,
              focusedPane: Math.min(group.focusedPane, panes.length - 1),
            },
            openKeys(),
            keepKey,
            (count) => autoLayout(count, group.orientation),
          );
          if (!ws) return null;
          set((current) => ({
            ...snapshot(
              { ...ws, layout: storedLayout(group.layout, ws.panes.length) ? ws.layout : null },
              { ...current, orientation: group.orientation, activeGroup: id },
            ),
            away: false,
          }));
          const focused = group.tabs[ws.focusedPane];
          return focused && !focused.connectionId ? focused : (local[0] ?? null);
        },
        saveTabs: (activeKey, id) => {
          const state = get();
          const scope = scopeKey();
          const resolve = tabResolver();
          const tabs = standaloneTabs(useTableTabs.getState().tabs, hiddenTabLists(state))
            .filter((tab) => !isWorkbench(tab))
            .flatMap((tab) => resolve(tabKey(tab)) ?? []);
          if (tabs.length === 0) return null;
          const content = {
            tabs: [tabs.find((tab) => tabKey(tab) === activeKey) ?? tabs[0]],
            paneTabs: [tabs],
          };
          const existing = state.groups[scope] ?? [];
          if (id) {
            if (!existing.some((group) => group.id === id && isTabSet(group))) return null;
            set(
              groupsPatch(
                state,
                scope,
                existing.map((group) => (group.id === id ? { ...group, ...content } : group)),
              ),
            );
            return id;
          }
          const { list, full } = evictable(existing, state.activeGroup);
          if (full) return null;
          let number = 1;
          while (list.some((group) => group.name === `Gruppe ${number}`)) number++;
          const group: SplitGroup = {
            id: crypto.randomUUID(),
            name: `Gruppe ${number}`,
            ...content,
            masters: [null],
            orientation: "horizontal",
            focusedPane: 0,
          };
          set(groupsPatch(state, scope, [...list, group]));
          return group.id;
        },
        adoptGroup: (id, connectionId) => {
          const state = get();
          const scope = scopeKey();
          const source = state.groups[connectionId]?.find((group) => group.id === id);
          if (!source) return null;
          if (connectionId === scope) return id;
          const existing = state.groups[scope] ?? [];
          const adopted = existing.find((group) => group.origin === id);
          if (adopted) return adopted.id;
          const { list, full } = evictable(existing, state.activeGroup);
          if (full) return null;
          const home = new Map(
            (useTableTabs.getState().tabsByConnection[connectionId] ?? []).map((tab) => [
              tabKey(tab),
              tab,
            ]),
          );
          const copies = new Map<string, Tab | null>();
          const taken = new Set(
            [...source.tabs, ...groupPaneTabs(source).flat()].flatMap((tab) =>
              tab?.connectionId === scope ? tabKey(ownTab(tab)) : [],
            ),
          );
          const closed = { ...state.closedTabs[scope] };
          const paneConnections = { ...state.paneConnections };
          const adopt = (tab: Tab | null): Tab | null => {
            if (!tab) return null;
            const key = tabKey(tab);
            const known = copies.get(key);
            if (known !== undefined) return known;
            let copy: Tab | null = tab;
            if (tab.connectionId === scope) copy = ownTab(tab);
            else if (tab.connectionId) copy = tab;
            else if (taken.has(key)) copy = { ...tab, connectionId };
            else if (!portable(tab)) copy = null;
            else if (tab.kind === "query") {
              const live = home.get(key) ?? state.closedTabs[connectionId]?.[key];
              const from = live?.kind === "query" ? live : tab;
              const stub = queryStub({ id: crypto.randomUUID(), title: from.title });
              closed[tabKey(stub)] = { ...stub, sql: from.sql };
              copy = stub;
            }
            copies.set(key, copy);
            const override = state.paneConnections[`${connectionId}|${key}`];
            if (copy && !tab.connectionId && !copy.connectionId && override && override !== scope)
              paneConnections[`${scope}|${tabKey(copy)}`] = override;
            return copy;
          };
          const lists = groupPaneTabs(source).map((tabs) =>
            tabs.flatMap((tab) => adopt(tab) ?? []),
          );
          if (lists.every((tabs) => tabs.length === 0)) return null;
          const tabs = source.tabs.map((tab, index) => adopt(tab) ?? lists[index]?.[0] ?? null);
          const group: SplitGroup = {
            ...source,
            id: crypto.randomUUID(),
            origin: id,
            shared: undefined,
            tabs,
            paneTabs:
              isTabSet(source) || lists.some((entries) => entries.length > 1) ? lists : undefined,
          };
          set({ ...groupsPatch(state, scope, [...list, group], closed), paneConnections });
          return group.id;
        },
        retargetGroup: (id, schemas) =>
          set((state) => {
            const scope = scopeKey();
            const group = state.groups[scope]?.find((entry) => entry.id === id);
            if (!group) return state;
            const lists = groupPaneTabs(group);
            const local = new Set(
              [...group.tabs, ...lists.flat()].flatMap((tab) =>
                tab && !tab.connectionId ? [tabKey(tab)] : [],
              ),
            );
            const home = Object.keys(state.groups).find(
              (key) =>
                key !== scope && state.groups[key].some((entry) => entry.id === group.origin),
            );
            let changed = false;
            const move = (tab: Tab | null): Tab | null => {
              if (!tab || tab.connectionId || !("schema" in tab) || !portable(tab)) return tab;
              const schema = schemas.get(tab.schema);
              if (!schema || schema === tab.schema) return tab;
              if (state.paneConnections[`${scope}|${tabKey(tab)}`]) return tab;
              const moved = { ...tab, schema };
              const taken = local.has(tabKey(moved));
              if (taken && !(home && tab.kind === "table")) return tab;
              changed = true;
              return taken ? { ...tab, connectionId: home } : moved;
            };
            const tabs = group.tabs.map(move);
            const paneTabs = group.paneTabs?.map((list) => list.flatMap((tab) => move(tab) ?? []));
            if (!changed) return state;
            return {
              groups: {
                ...state.groups,
                [scope]: state.groups[scope].map((entry) =>
                  entry.id === id ? { ...group, tabs, paneTabs } : entry,
                ),
              },
            };
          }),
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
          const { groups, closedTabs } = groupsPatch(
            state,
            scope,
            (state.groups[scope] ?? []).filter((group) => group.id !== id),
          );
          const openGroups = withoutOpen(state.openGroups, scope, id);
          if (state.activeGroup !== id || scope !== scopeKey()) {
            set({ groups, closedTabs, openGroups });
            return;
          }
          set({
            ...snapshot(SINGLE, { ...state, groups, openGroups, activeGroup: null }),
            closedTabs,
          });
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
          const before = get();
          if (activeKey && !key && before.panes.length > 1 && !isSplitShown(before, activeKey)) {
            set(snapshot(liveOf(before), before));
            set(snapshot(SINGLE, get()));
          }
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
            layout: auto ? (count) => autoLayout(count, orientation) : undefined,
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
          const openGroups = withoutOpen(state.openGroups, scopeKey(), state.activeGroup);
          set(snapshot(SINGLE, { ...state, openGroups }));
          reorderOpenTabs(state.paneTabs.flat());
        },

        closeView: (id) => {
          const state = get();
          if (state.panes.length > 1 && state.activeGroup === id) {
            state.collapse();
            return;
          }
          set({ openGroups: withoutOpen(state.openGroups, scopeKey(), id) });
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
            return addTabs(kept, added);
          }),

        clearForConnection: (connectionId) =>
          set((state) => {
            const byConnection = { ...state.byConnection };
            delete byConnection[connectionId];
            const groups = { ...state.groups };
            delete groups[connectionId];
            const closedTabs = { ...state.closedTabs };
            delete closedTabs[connectionId];
            const openGroups = { ...state.openGroups };
            delete openGroups[connectionId];
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
                closedTabs,
                openGroups,
                paneConnections,
              };
            }
            return { byConnection, groups, closedTabs, openGroups, paneConnections };
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
        openGroups: state.openGroups,
        closedTabs: state.closedTabs,
      }),
      merge: (persistedState, currentState) => {
        const stored = persistedState as Partial<SplitState> | undefined;
        const byConnection = stored?.byConnection ?? {};
        const groups = stored?.groups ?? {};
        return {
          ...currentState,
          byConnection,
          paneConnections: stored?.paneConnections ?? {},
          groups,
          openGroups: stored?.openGroups ?? {},
          closedTabs: Object.fromEntries(
            Object.entries(stored?.closedTabs ?? {}).map(([scope, closed]) => [
              scope,
              usedCopies(closed, groups[scope]),
            ]),
          ),
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

export function parkedViews(
  state: Pick<SplitState, "groups" | "openGroups" | "activeGroup" | "panes">,
): SplitGroup[] {
  const scope = scopeKey();
  const live = state.panes.length > 1 ? state.activeGroup : null;
  const groups = state.groups[scope] ?? [];
  return (state.openGroups[scope] ?? []).flatMap((id) => {
    if (id === live) return [];
    const group = groups.find((entry) => entry.id === id);
    return group && !isTabSet(group) ? [group] : [];
  });
}

export function hiddenTabLists(
  state: Pick<SplitState, "groups" | "openGroups" | "activeGroup" | "panes" | "paneTabs">,
): string[][] {
  const parked = parkedViews(state).flatMap((group) =>
    groupPaneTabs(group).map((tabs) => tabs.map(tabKey)),
  );
  return parked.length > 0 ? [...state.paneTabs, ...parked] : state.paneTabs;
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
  const adopted = new Set(
    (groups[keyForConnection(activeId)] ?? []).flatMap((group) => group.origin ?? []),
  );
  return connections.flatMap((connection) =>
    connection.id === activeId
      ? []
      : (groups[connection.id] ?? [])
          .filter((group) => group.shared && !adopted.has(group.id))
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

export function paneConnectionId(
  state: Pick<SplitState, "paneConnections">,
  key: string | null,
  activeId: string | null,
  connections: { id: string }[],
): string | null {
  const override = key
    ? (remoteTab(key)?.connectionId ??
      state.paneConnections[`${keyForConnection(activeId)}|${key}`] ??
      null)
    : null;
  if (!override || override === activeId) return null;
  return connections.some((entry) => entry.id === override) ? override : null;
}

export function focusedConnectionId(
  state: Pick<SplitState, "panes" | "paneTabs" | "away" | "focusedPane" | "paneConnections">,
  routeKey: string | null,
  activeId: string | null,
  connections: { id: string }[],
): string | null {
  if (!isSplitShown(state, routeKey)) return activeId;
  const key = state.panes[state.focusedPane] ?? `split-detail:${state.focusedPane}`;
  return paneConnectionId(state, key, activeId, connections) ?? activeId;
}

export function usePaneConnectionId(key: string | null): string | null {
  const activeId = useConnectionsStore((state) => state.activeId);
  const connections = useConnectionsStore((state) => state.connections);
  return useSplitView((state) => paneConnectionId(state, key, activeId, connections));
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
    const stored: Partial<SplitState> | null = value ? JSON.parse(value)?.state : null;
    const groups = stored?.groups;
    if (!groups) return;
    const { activeGroup } = useSplitView.getState();
    useSplitView.setState({ groups, closedTabs: stored.closedTabs ?? {} });
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
  if (sameKeys(previous.tabs, state.tabs)) return;
  const before = new Set(previous.tabs.map(tabKey));
  const open = state.tabs.map(tabKey);
  useSplitView.getState().syncTabs(
    open,
    open.filter((key) => !before.has(key)),
  );
  syncGroupCopies(previous.tabs, state.tabs);
});

function sameKeys(previous: Tab[], current: Tab[]) {
  return (
    previous.length === current.length &&
    current.every(
      (tab, index) => tab === previous[index] || tabKey(tab) === tabKey(previous[index]),
    )
  );
}

function usedCopies(
  closed: Record<string, Tab> | undefined,
  groups: SplitGroup[] | undefined,
): Record<string, Tab> {
  if (!closed) return {};
  const used = new Set<string>();
  for (const group of groups ?? [])
    for (const tab of [...group.tabs, ...(group.paneTabs?.flat() ?? [])])
      if (keepsContent(tab)) used.add(tabKey(tab));
  return Object.fromEntries(Object.entries(closed).filter(([key]) => used.has(key)));
}

function syncGroupCopies(previous: Tab[], current: Tab[]) {
  if (previous.length === current.length) return;
  const closing = previous.length > current.length;
  const kept = new Set<string>();
  for (const tab of closing ? current : previous) if (keepsContent(tab)) kept.add(tabKey(tab));
  const changed = (closing ? previous : current).filter(
    (tab) => keepsContent(tab) && !kept.has(tabKey(tab)),
  );
  if (changed.length === 0) return;
  const scope = scopeKey();
  const state = useSplitView.getState();
  const stored = state.closedTabs[scope] ?? {};
  const closed = { ...stored };
  const copies = closing
    ? usedCopies(Object.fromEntries(changed.map((tab) => [tabKey(tab), tab])), state.groups[scope])
    : {};
  for (const [key, tab] of Object.entries(copies)) {
    const before = stored[key];
    if (tab.kind !== "query") closed[key] = tab;
    else if (tab.sql !== "" || before?.kind !== "query") closed[key] = { ...tab, autoRun: false };
  }
  if (!closing) for (const tab of changed) delete closed[tabKey(tab)];
  if (Object.keys(closed).length === Object.keys(stored).length && Object.keys(copies).length === 0)
    return;
  useSplitView.setState({ closedTabs: { ...state.closedTabs, [scope]: closed } });
}
