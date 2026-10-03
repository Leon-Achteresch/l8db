import {
  CLUSTER_GAP,
  CLUSTER_HEADER_HEIGHT,
  CLUSTER_NODE_GAP,
  CLUSTER_PADDING,
  NODE_WIDTH,
} from "@/features/er-diagram/er-diagram-view/constants";
import { estimateNodeHeight } from "@/features/er-diagram/er-diagram-view/node-dimensions";
import type { ErCluster } from "@/lib/er-clusters";
import { erTableKey, erTableKeyOf } from "@/lib/er-focus";

export interface ErClusterFrame {
  cluster: ErCluster;
  position: { x: number; y: number };
  width: number;
  height: number;
  positions: Map<string, { x: number; y: number }>;
}

export function buildClusterFrames(clusters: ErCluster[]): ErClusterFrame[] {
  const frames = clusters.map((cluster) => {
    const columnCapacity = Math.ceil(Math.sqrt(cluster.tables.length));
    const positions = new Map<string, { x: number; y: number }>();
    const neighbors = new Map(
      cluster.tables.map((table) => [erTableKeyOf(table), new Set<string>()]),
    );
    for (const fk of cluster.foreignKeys) {
      const from = erTableKey(fk.from_schema, fk.from_table);
      const to = erTableKey(fk.to_schema, fk.to_table);
      neighbors.get(from)?.add(to);
      neighbors.get(to)?.add(from);
    }
    const anchor = erTableKeyOf(cluster.tables[0]);
    const distances = new Map([[anchor, 0]]);
    const queue = [anchor];
    for (let index = 0; index < queue.length; index++) {
      for (const neighbor of neighbors.get(queue[index]) ?? []) {
        if (distances.has(neighbor)) continue;
        distances.set(neighbor, (distances.get(queue[index]) ?? 0) + 1);
        queue.push(neighbor);
      }
    }
    const maxDistance = Math.max(...distances.values());
    const layers = new Map<number, typeof cluster.tables>();
    for (const table of cluster.tables) {
      const layer = cluster.isolated ? 0 : maxDistance - (distances.get(erTableKeyOf(table)) ?? 0);
      const members = layers.get(layer);
      if (members) members.push(table);
      else layers.set(layer, [table]);
    }
    const columns = [...layers.entries()]
      .sort(([a], [b]) => a - b)
      .flatMap(([, tables]) => {
        const groups: (typeof tables)[] = [];
        for (let start = 0; start < tables.length; start += columnCapacity)
          groups.push(tables.slice(start, start + columnCapacity));
        return groups;
      });
    const columnHeights = columns.map(
      (column) =>
        column.reduce((sum, table) => sum + estimateNodeHeight(table), 0) +
        (column.length - 1) * CLUSTER_NODE_GAP,
    );
    const contentHeight = Math.max(...columnHeights);
    for (const [index, column] of columns.entries()) {
      let y = CLUSTER_HEADER_HEIGHT + CLUSTER_PADDING + (contentHeight - columnHeights[index]) / 2;
      for (const table of column) {
        positions.set(erTableKeyOf(table), {
          x: CLUSTER_PADDING + index * (NODE_WIDTH + CLUSTER_NODE_GAP),
          y,
        });
        y += estimateNodeHeight(table) + CLUSTER_NODE_GAP;
      }
    }
    return {
      cluster,
      position: { x: 0, y: 0 },
      width: Math.max(
        480,
        columns.length * (NODE_WIDTH + CLUSTER_NODE_GAP) - CLUSTER_NODE_GAP + CLUSTER_PADDING * 2,
      ),
      height: Math.max(360, contentHeight + CLUSTER_HEADER_HEIGHT + CLUSTER_PADDING * 2),
      positions,
    };
  });
  const columns = Math.ceil(Math.sqrt(frames.length));
  const columnWidths = Array.from({ length: columns }, (_, index) =>
    Math.max(
      ...frames
        .filter((_, frameIndex) => frameIndex % columns === index)
        .map((frame) => frame.width),
    ),
  );
  let y = 0;
  for (let start = 0; start < frames.length; start += columns) {
    const row = frames.slice(start, start + columns);
    let x = 0;
    for (const [index, frame] of row.entries()) {
      frame.position = { x, y };
      x += columnWidths[index] + CLUSTER_GAP;
    }
    y += Math.max(...row.map((frame) => frame.height)) + CLUSTER_GAP;
  }
  return frames;
}

export function fitClusterLayout(
  frame: ErClusterFrame,
  positions: Map<string, { x: number; y: number }>,
): Map<string, { x: number; y: number }> {
  if (frame.cluster.tables.some((table) => !positions.has(erTableKeyOf(table))))
    return frame.positions;
  const rectangles = frame.cluster.tables.map((table) => ({
    ...positions.get(erTableKeyOf(table)),
    width: NODE_WIDTH,
    height: estimateNodeHeight(table),
  }));
  for (const [index, rectangle] of rectangles.entries()) {
    if (
      rectangle.x === undefined ||
      rectangle.y === undefined ||
      !Number.isFinite(rectangle.x) ||
      !Number.isFinite(rectangle.y) ||
      rectangle.x < 0 ||
      rectangle.y < 0
    )
      return frame.positions;
    for (const other of rectangles.slice(index + 1)) {
      if (other.x === undefined || other.y === undefined) return frame.positions;
      if (
        rectangle.x < other.x + other.width + 24 &&
        other.x < rectangle.x + rectangle.width + 24 &&
        rectangle.y < other.y + other.height + 24 &&
        other.y < rectangle.y + rectangle.height + 24
      )
        return frame.positions;
    }
  }
  const width = Math.max(
    ...frame.cluster.tables.map(
      (table) => (positions.get(erTableKeyOf(table))?.x ?? 0) + NODE_WIDTH,
    ),
  );
  const height = Math.max(
    ...frame.cluster.tables.map(
      (table) => (positions.get(erTableKeyOf(table))?.y ?? 0) + estimateNodeHeight(table),
    ),
  );
  if (
    width > frame.width - CLUSTER_PADDING * 2 ||
    height > frame.height - CLUSTER_HEADER_HEIGHT - CLUSTER_PADDING * 2
  )
    return frame.positions;
  const offsetX = (frame.width - width) / 2;
  const offsetY = CLUSTER_HEADER_HEIGHT + CLUSTER_PADDING;
  return new Map(
    [...positions].map(([id, position]) => [
      id,
      { x: position.x + offsetX, y: position.y + offsetY },
    ]),
  );
}
