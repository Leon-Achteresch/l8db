import type { SplitLayout } from "@/lib/ui-plugins/api";

export type SplitAxis = "row" | "column";
export type SplitEdge = "left" | "right" | "top" | "bottom";
export type SplitZone = SplitEdge | "center";
export type SplitTree = { dir: SplitAxis; children: SplitTree[] } | null;

export function edgeAxis(edge: SplitEdge): SplitAxis {
  return edge === "left" || edge === "right" ? "row" : "column";
}

export function edgeBefore(edge: SplitEdge): boolean {
  return edge === "left" || edge === "top";
}

export function leafCount(tree: SplitTree): number {
  return tree ? tree.children.reduce((sum, child) => sum + leafCount(child), 0) : 1;
}

function line(dir: SplitAxis, count: number): SplitTree {
  return { dir, children: Array.from({ length: count }, () => null) };
}

export function namedLayout(layout: SplitLayout, count: number): SplitTree {
  if (count < 2) return null;
  if (layout === "rows" || (count === 2 && layout === "topStack")) return line("column", count);
  if (layout === "columns" || count === 2) return line("row", count);
  if (layout === "leftStack") return { dir: "row", children: [null, line("column", count - 1)] };
  if (layout === "topStack") return { dir: "column", children: [null, line("row", count - 1)] };
  return { dir: "column", children: [line("row", 2), count === 3 ? null : line("row", count - 2)] };
}

export type SplitOrientation = "horizontal" | "vertical";

export function defaultSplitLayout(count: number, orientation: SplitOrientation): SplitLayout {
  if (count === 2) return orientation === "horizontal" ? "columns" : "rows";
  return count === 3 ? "leftStack" : "grid";
}

export function autoLayout(
  count: number,
  orientation: SplitOrientation,
  plugin?: ((count: number, orientation: SplitOrientation) => SplitLayout | undefined) | null,
): SplitTree {
  return namedLayout(
    (count > 1 && plugin?.(count, orientation)) || defaultSplitLayout(count, orientation),
    count,
  );
}

function normalize(tree: SplitTree): SplitTree {
  if (!tree) return null;
  const children = tree.children.flatMap((child) => {
    const next = normalize(child);
    return next && next.dir === tree.dir ? next.children : [next];
  });
  return children.length === 1 ? children[0] : { dir: tree.dir, children };
}

export function insertLeaf(tree: SplitTree, index: number, edge: SplitEdge): SplitTree {
  let seen = 0;
  const visit = (node: SplitTree): SplitTree => {
    if (!node) return seen++ === index ? line(edgeAxis(edge), 2) : null;
    return { dir: node.dir, children: node.children.map(visit) };
  };
  return normalize(visit(tree));
}

export function removeLeaf(tree: SplitTree, index: number): SplitTree {
  let seen = 0;
  const visit = (node: SplitTree): SplitTree[] => {
    if (!node) return seen++ === index ? [] : [null];
    const children = node.children.flatMap(visit);
    return children.length === 0 ? [] : [{ dir: node.dir, children }];
  };
  return normalize(visit(tree)[0] ?? null);
}

export function transposeLayout(tree: SplitTree): SplitTree {
  return tree
    ? { dir: tree.dir === "row" ? "column" : "row", children: tree.children.map(transposeLayout) }
    : null;
}

export function isSplitTree(value: unknown): value is SplitTree {
  if (value === null) return true;
  if (typeof value !== "object") return false;
  const node = value as { dir?: unknown; children?: unknown };
  return (
    (node.dir === "row" || node.dir === "column") &&
    Array.isArray(node.children) &&
    node.children.length >= 2 &&
    node.children.every(isSplitTree)
  );
}

export function dropZone(
  rect: { left: number; top: number; width: number; height: number },
  x: number,
  y: number,
  edges = true,
): SplitZone {
  if (!edges || rect.width <= 0 || rect.height <= 0) return "center";
  const fx = (x - rect.left) / rect.width;
  const fy = (y - rect.top) / rect.height;
  const [edge, distance] = (
    [
      ["left", fx],
      ["right", 1 - fx],
      ["top", fy],
      ["bottom", 1 - fy],
    ] as const
  ).reduce((closest, entry) => (entry[1] < closest[1] ? entry : closest));
  return distance < 0.3 ? edge : "center";
}
