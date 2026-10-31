import {
  edgeBefore,
  insertLeaf,
  isSplitTree,
  leafCount,
  removeLeaf,
  type SplitEdge,
  type SplitTree,
} from "@/lib/split-layout";
import { normalizeMasters, type PaneMasters, swapMasters } from "@/lib/split-links";

export const MAX_SPLIT_PANES = 4;

export type PaneWorkspace = {
  panes: (string | null)[];
  paneTabs: string[][];
  masters: PaneMasters;
  layout: SplitTree;
  focusedPane: number;
};

type Pane = { tabs: string[]; active: string | null; master: Pane | null };
type Model = { panes: Pane[]; layout: SplitTree; focused: Pane | null };

function toModel(ws: PaneWorkspace): Model {
  const panes: Pane[] = ws.panes.map((active, index) => ({
    tabs: [...(ws.paneTabs[index] ?? [])],
    active,
    master: null,
  }));
  ws.masters.forEach((master, index) => {
    if (master !== null && panes[master] && panes[index]) panes[index].master = panes[master];
  });
  return { panes, layout: ws.layout, focused: panes[ws.focusedPane] ?? panes[0] ?? null };
}

function toWorkspace(model: Model): PaneWorkspace {
  const { panes } = model;
  const masters = panes.map((pane) => {
    const index = pane.master ? panes.indexOf(pane.master) : -1;
    return index === -1 ? null : index;
  });
  return {
    panes: panes.map((pane) => pane.active),
    paneTabs: panes.map((pane) => pane.tabs),
    masters: normalizeMasters(masters, panes.length),
    layout: model.layout,
    focusedPane: Math.max(0, model.focused ? panes.indexOf(model.focused) : 0),
  };
}

function takeTab(pane: Pane, key: string, recent: readonly string[]) {
  const at = pane.tabs.indexOf(key);
  if (at === -1) return;
  pane.tabs.splice(at, 1);
  if (pane.active !== key) return;
  pane.active =
    recent.find((entry) => pane.tabs.includes(entry)) ?? pane.tabs[at] ?? pane.tabs[at - 1] ?? null;
}

function insertPane(model: Model, target: Pane, edge: SplitEdge, pane: Pane) {
  const index = model.panes.indexOf(target);
  model.layout = insertLeaf(model.layout, index, edge);
  model.panes.splice(edgeBefore(edge) ? index : index + 1, 0, pane);
}

function removePane(model: Model, pane: Pane) {
  const index = model.panes.indexOf(pane);
  if (index === -1) return;
  model.layout = removeLeaf(model.layout, index);
  model.panes.splice(index, 1);
  for (const other of model.panes) if (other.master === pane) other.master = null;
  if (model.focused === pane) model.focused = model.panes[Math.max(0, index - 1)] ?? null;
}

export function paneOf(ws: PaneWorkspace, key: string): number {
  return ws.paneTabs.findIndex((tabs) => tabs.includes(key));
}

export function singlePane(tabs: string[], active: string | null): PaneWorkspace {
  return {
    panes: [active && tabs.includes(active) ? active : (tabs[0] ?? null)],
    paneTabs: [tabs],
    masters: [null],
    layout: null,
    focusedPane: 0,
  };
}

export function splitPane(
  ws: PaneWorkspace,
  options: {
    key: string | null;
    target: number;
    edge: SplitEdge;
    recent?: readonly string[];
    layout?: (count: number) => SplitTree;
  },
): PaneWorkspace {
  const model = toModel(ws);
  const into = model.panes[options.target];
  if (!into) return ws;
  const wanted = options.key;
  const found = wanted ? model.panes.find((pane) => pane.tabs.includes(wanted)) : null;
  if (wanted && !found) return ws;
  const key = found === into && into.tabs.length === 1 ? null : options.key;
  const source = key ? found : null;
  const emptied = Boolean(source && source !== into && source.tabs.length === 1);
  if (model.panes.length + 1 - (emptied ? 1 : 0) > MAX_SPLIT_PANES) return ws;
  const pane: Pane = { tabs: key ? [key] : [], active: key, master: into };
  if (source && key) takeTab(source, key, options.recent ?? []);
  insertPane(model, into, options.edge, pane);
  if (emptied && source) removePane(model, source);
  if (options.layout) model.layout = options.layout(model.panes.length);
  model.focused = pane;
  return toWorkspace(model);
}

export function moveTab(
  ws: PaneWorkspace,
  key: string,
  to: number,
  at?: number,
  recent: readonly string[] = [],
): PaneWorkspace {
  const model = toModel(ws);
  const target = model.panes[to];
  if (!target) return ws;
  const source = model.panes.find((pane) => pane.tabs.includes(key));
  if (source !== target || at !== undefined) {
    if (source === target) target.tabs.splice(target.tabs.indexOf(key), 1);
    else if (source) takeTab(source, key, recent);
    const index = Math.min(Math.max(at ?? target.tabs.length, 0), target.tabs.length);
    target.tabs.splice(index, 0, key);
  }
  target.active = key;
  model.focused = target;
  if (source && source !== target && source.tabs.length === 0) removePane(model, source);
  return toWorkspace(model);
}

export function closePane(ws: PaneWorkspace, index: number): PaneWorkspace {
  const model = toModel(ws);
  const pane = model.panes[index];
  if (!pane) return ws;
  const neighbor = model.panes[index - 1] ?? model.panes[index + 1];
  if (neighbor) {
    neighbor.tabs.push(...pane.tabs.filter((key) => !neighbor.tabs.includes(key)));
    if (model.focused === pane || !neighbor.active)
      neighbor.active = pane.active ?? neighbor.active ?? neighbor.tabs[0] ?? null;
    if (model.focused === pane) model.focused = neighbor;
  }
  removePane(model, pane);
  return toWorkspace(model);
}

export function removeTabs(
  ws: PaneWorkspace,
  gone: (key: string) => boolean,
  recent: readonly string[] = [],
): PaneWorkspace {
  if (!ws.paneTabs.some((tabs) => tabs.some(gone)) && !ws.panes.some((key) => key && gone(key)))
    return ws;
  const model = toModel(ws);
  for (const pane of [...model.panes]) {
    const had = pane.tabs.length > 0;
    for (const key of pane.tabs.filter(gone)) takeTab(pane, key, recent);
    if (pane.active && gone(pane.active)) pane.active = pane.tabs[0] ?? null;
    if (had && pane.tabs.length === 0 && model.panes.length > 1) removePane(model, pane);
  }
  return toWorkspace(model);
}

export function addTabs(ws: PaneWorkspace, keys: string[], afterActive = false): PaneWorkspace {
  const assigned = new Set(ws.paneTabs.flat());
  const fresh = keys.filter((key) => !assigned.has(key));
  if (fresh.length === 0) return ws;
  const index = Math.min(ws.focusedPane, ws.panes.length - 1);
  const tabs = [...ws.paneTabs[index]];
  const active = ws.panes[index];
  const after = afterActive && active ? tabs.indexOf(active) + 1 : 0;
  tabs.splice(after > 0 ? after : tabs.length, 0, ...fresh);
  return {
    ...ws,
    panes: active ? ws.panes : ws.panes.map((key, i) => (i === index ? fresh[0] : key)),
    paneTabs: ws.paneTabs.map((list, i) => (i === index ? tabs : list)),
  };
}

export function revealTab(ws: PaneWorkspace, key: string): PaneWorkspace {
  const found = paneOf(ws, key);
  const next = found === -1 ? addTabs(ws, [key]) : ws;
  const index = found === -1 ? Math.min(ws.focusedPane, ws.panes.length - 1) : found;
  if (next.panes[index] === key && next.focusedPane === index) return next;
  return {
    ...next,
    panes: next.panes.map((entry, i) => (i === index ? key : entry)),
    focusedPane: index,
  };
}

export function swapPanes(ws: PaneWorkspace, from: number, to: number): PaneWorkspace {
  const count = ws.panes.length;
  if (from === to || from < 0 || to < 0 || from >= count || to >= count) return ws;
  const swap = <T>(list: T[]) => {
    const next = [...list];
    [next[from], next[to]] = [next[to], next[from]];
    return next;
  };
  return {
    ...ws,
    panes: swap(ws.panes),
    paneTabs: swap(ws.paneTabs),
    masters: swapMasters(ws.masters, from, to),
    focusedPane: to,
  };
}

export function normalizeWorkspace(
  entry: {
    panes?: unknown;
    paneTabs?: unknown;
    masters?: unknown;
    layout?: unknown;
    focusedPane?: unknown;
  },
  open: string[],
  keep: (key: string) => boolean,
  fallbackLayout: (count: number) => SplitTree,
): PaneWorkspace | null {
  const raw = Array.isArray(entry.panes) ? entry.panes : [];
  if (raw.length < 2) return null;
  const stored =
    Array.isArray(entry.paneTabs) && entry.paneTabs.length === raw.length ? entry.paneTabs : null;
  const seen = new Set<string>();
  const paneTabs = raw.map((active, index) => {
    const list: unknown[] = stored && Array.isArray(stored[index]) ? [...stored[index]] : [];
    if (typeof active === "string" && !list.includes(active)) list.unshift(active);
    return list.filter((key): key is string => {
      if (typeof key !== "string" || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  });
  const focused = Number(entry.focusedPane);
  const openKeys = new Set(open);
  const ws = removeTabs(
    {
      panes: raw.map((active, index) =>
        typeof active === "string" && paneTabs[index].includes(active)
          ? active
          : (paneTabs[index][0] ?? null),
      ),
      paneTabs,
      masters: normalizeMasters(entry.masters, raw.length),
      layout:
        isSplitTree(entry.layout) && leafCount(entry.layout) === raw.length
          ? entry.layout
          : fallbackLayout(raw.length),
      focusedPane: Number.isInteger(focused) && focused >= 0 && focused < raw.length ? focused : 0,
    },
    (key) => !openKeys.has(key) && !keep(key),
  );
  if (ws.panes.length < 2) return null;
  return addTabs(ws, open);
}
