import type { DroppableInput } from "@dnd-kit/dom";
import { create } from "zustand";
import { dropZone, type SplitEdge, type SplitZone } from "@/lib/split-layout";
import { MAX_SPLIT_PANES } from "@/lib/split-panes";

export type TabDragData = { key: string; group: string; pane: number | null };

export type DropPreview = {
  pane: number | "single" | "master";
  zone?: SplitZone;
  swap?: boolean;
  at?: number;
  x?: number;
};

type Rect = { left: number; top: number; width: number; height: number };

export type DropSource = { type: "tab"; key: string } | { type: "pane"; index: number };

export type DropTarget =
  | {
      type: "strip";
      pane: number | "master";
      left: number;
      tabs: { left: number; right: number }[];
    }
  | { type: "pane"; pane: number | "single"; rect: Rect };

export type DropAction =
  | { type: "move"; key: string; pane: number; at?: number }
  | { type: "detach"; key: string; at: number }
  | { type: "split"; key: string; pane: number | "single"; edge: SplitEdge }
  | { type: "show"; key: string }
  | { type: "swap"; from: number; to: number };

export function resolveDrop(
  source: DropSource,
  target: DropTarget | null,
  point: { x: number; y: number },
  state: { paneTabs: string[][]; single: string[]; active: string | null },
): { action: DropAction; preview: DropPreview } | null {
  if (!target) return null;
  if (source.type === "pane") {
    if (target.type !== "pane" || target.pane === "single" || target.pane === source.index)
      return null;
    return {
      action: { type: "swap", from: source.index, to: target.pane },
      preview: { pane: target.pane, zone: "center", swap: true },
    };
  }
  const { key } = source;
  if (target.type === "strip") {
    const { tabs } = target;
    const at = tabs.filter((tab) => (tab.left + tab.right) / 2 < point.x).length;
    const x = at < tabs.length ? tabs[at].left - 2 : (tabs.at(-1)?.right ?? target.left + 2) + 1;
    const preview = { pane: target.pane, at, x: x - target.left };
    return target.pane === "master"
      ? { action: { type: "detach", key, at }, preview }
      : { action: { type: "move", key, pane: target.pane, at }, preview };
  }
  if (target.pane === "single") {
    const edges = state.single.length > 1 && state.single.includes(key);
    const zone = dropZone(target.rect, point.x, point.y, edges);
    if (zone !== "center")
      return {
        action: { type: "split", key, pane: "single", edge: zone },
        preview: { pane: "single", zone },
      };
    return key === state.active
      ? null
      : { action: { type: "show", key }, preview: { pane: "single", zone } };
  }
  const { pane } = target;
  const from = state.paneTabs.findIndex((tabs) => tabs.includes(key));
  const only = from === pane && state.paneTabs[pane]?.length === 1;
  const emptied = from !== -1 && from !== pane && state.paneTabs[from].length === 1;
  const room = state.paneTabs.length + (emptied ? 0 : 1) <= MAX_SPLIT_PANES;
  const zone = dropZone(target.rect, point.x, point.y, !only && room);
  if (zone !== "center")
    return { action: { type: "split", key, pane, edge: zone }, preview: { pane, zone } };
  return from === pane ? null : { action: { type: "move", key, pane }, preview: { pane, zone } };
}

export const useDropPreview = create<{ preview: DropPreview | null }>(() => ({ preview: null }));

export function showDropPreview(preview: DropPreview | null) {
  const current = useDropPreview.getState().preview;
  if (
    current?.pane === preview?.pane &&
    current?.zone === preview?.zone &&
    current?.swap === preview?.swap &&
    current?.at === preview?.at &&
    current?.x === preview?.x
  )
    return;
  useDropPreview.setState({ preview });
}

export function tabDragData(data: unknown): TabDragData | null {
  const value = data as Partial<TabDragData> | null | undefined;
  return typeof value?.key === "string" && typeof value.group === "string"
    ? { key: value.key, group: value.group, pane: value.pane ?? null }
    : null;
}

export const underPointer: NonNullable<DroppableInput["collisionDetector"]> = ({
  dragOperation,
  droppable,
}) => {
  const point = dragOperation.position.current;
  const shape = droppable.shape;
  if (!point || !shape?.containsPoint(point)) return null;
  const distance = Math.hypot(shape.center.x - point.x, shape.center.y - point.y);
  return { id: droppable.id, value: 1 / Math.max(distance, 1), type: 2, priority: 3 };
};

export const ZONE_LABELS: Record<SplitZone, string> = {
  left: "Links teilen",
  right: "Rechts teilen",
  top: "Oben teilen",
  bottom: "Unten teilen",
  center: "Hier anzeigen",
};
