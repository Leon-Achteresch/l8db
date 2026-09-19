import type { Tab } from "@/lib/table-tabs";

export type PaneMasters = (number | null)[];
export type PaneBox = { left: number; top: number; right: number; bottom: number };
export type LinkAnchor = { x: number; y: number; angle: number };

const EDGE = 4;
const SHARED = 40;

export function chainMasters(count: number): PaneMasters {
  return Array.from({ length: count }, (_, index) => (index > 0 ? index - 1 : null));
}

export function isAncestor(masters: PaneMasters, ancestor: number, pane: number): boolean {
  let current = masters[pane] ?? null;
  for (let steps = 0; current !== null && steps < masters.length; steps++) {
    if (current === ancestor) return true;
    current = masters[current] ?? null;
  }
  return false;
}

export function normalizeMasters(masters: unknown, count: number): PaneMasters {
  if (
    !Array.isArray(masters) ||
    masters.length !== count ||
    !masters.every(
      (master, index) =>
        master === null ||
        (Number.isInteger(master) && master >= 0 && master < count && master !== index),
    ) ||
    masters.some((_, index) => isAncestor(masters, index, index))
  )
    return chainMasters(count);
  return masters;
}

export function swapMasters(masters: PaneMasters, a: number, b: number): PaneMasters {
  const next = [...masters];
  [next[a], next[b]] = [next[b] ?? null, next[a] ?? null];
  return next.map((master) => (master === a ? b : master === b ? a : master));
}

export function removeMaster(masters: PaneMasters, index: number): PaneMasters {
  return masters
    .filter((_, i) => i !== index)
    .map((master) =>
      master === null || master === index ? null : master > index ? master - 1 : master,
    );
}

function axis(a0: number, a1: number, b0: number, b1: number) {
  if (b0 >= a1 - EDGE) return { step: 1, mid: (a1 + b0) / 2, shared: 0 };
  if (b1 <= a0 + EDGE) return { step: -1, mid: (b1 + a0) / 2, shared: 0 };
  const low = Math.max(a0, b0);
  const high = Math.min(a1, b1);
  return { step: Math.sign(b0 + b1 - a0 - a1), mid: (low + high) / 2, shared: high - low };
}

export function linkAnchor(master: PaneBox, detail: PaneBox): LinkAnchor {
  const x = axis(master.left, master.right, detail.left, detail.right);
  const y = axis(master.top, master.bottom, detail.top, detail.bottom);
  const angle =
    y.shared >= SHARED
      ? x.step < 0
        ? 180
        : 0
      : x.shared >= SHARED
        ? y.step < 0
          ? -90
          : 90
        : (Math.atan2(y.step, x.step) * 180) / Math.PI;
  return { x: x.mid, y: y.mid, angle };
}

export function spreadAnchors(anchors: LinkAnchor[], gap = 28): LinkAnchor[] {
  const placed: LinkAnchor[] = [];
  for (const anchor of anchors) {
    const step =
      anchor.angle % 180 === 0
        ? { x: 0, y: gap }
        : anchor.angle % 90 === 0
          ? { x: gap, y: 0 }
          : { x: 0, y: -gap };
    let next = anchor;
    while (placed.some((other) => Math.hypot(other.x - next.x, other.y - next.y) < gap))
      next = { ...next, x: next.x + step.x, y: next.y + step.y };
    placed.push(next);
  }
  return placed;
}

export function linkableTab(tab: Tab | undefined): boolean {
  return !tab || tab.kind === "table" || tab.kind === "query";
}

export function canLink(
  masters: PaneMasters,
  paneTabs: (Tab | undefined)[],
  master: number,
  detail: number,
): boolean {
  const tab = paneTabs[master];
  return linkableTab(paneTabs[detail]) && (tab ? linkableTab(tab) : masters[master] != null);
}

export function masterCandidates(
  masters: PaneMasters,
  paneTabs: (Tab | undefined)[],
  detail: number,
): number[] {
  return masters.flatMap((_, pane) =>
    pane !== detail &&
    !isAncestor(masters, detail, pane) &&
    canLink(masters, paneTabs, pane, detail)
      ? [pane]
      : [],
  );
}
