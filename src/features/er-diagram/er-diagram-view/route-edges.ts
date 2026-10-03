import type { Edge } from "@xyflow/react";
import { buildEdges } from "@/features/er-diagram/er-diagram-view/build-graph";
import type { ErClusterFrame } from "@/features/er-diagram/er-diagram-view/cluster-layout";
import {
  CLUSTER_GAP,
  HEADER_HEIGHT,
  NODE_WIDTH,
  ROW_HEIGHT,
} from "@/features/er-diagram/er-diagram-view/constants";
import {
  type ErObstacle,
  type ErPoint,
  routeRelationship,
} from "@/features/er-diagram/er-diagram-view/route-relationship";
import type { TableNodeType } from "@/features/er-diagram/er-diagram-view/types";
import type { ForeignKeyInfo } from "@/lib/db";
import { erTableKey } from "@/lib/er-focus";

type TableEndpoint = { node: TableNodeType; frame: ErClusterFrame };
type Connection = {
  edge: Edge;
  source?: TableEndpoint;
  target?: TableEndpoint;
  sourceFrame: ErClusterFrame;
  targetFrame: ErClusterFrame;
  count: number;
  highlighted: boolean;
};

function endpoint(
  node: TableNodeType,
  handle: string | null | undefined,
  source: boolean,
): ErPoint {
  const column = Math.max(
    0,
    node.data.columns.findIndex(
      (entry) => entry.name + (source ? "-source" : "-target") === handle,
    ),
  );
  return {
    x: node.position.x + (source ? NODE_WIDTH + 4 : -4),
    y: node.position.y + HEADER_HEIGHT + column * (ROW_HEIGHT + 1) + ROW_HEIGHT / 2,
  };
}

export function buildRoutedEdges(
  frames: ErClusterFrame[],
  loaded: Map<string, TableNodeType[]>,
  expanded: Set<string>,
  selected: Set<string>,
  exporting: boolean,
  routeCache = new Map<string, ErPoint[]>(),
): Edge[] {
  const nodes = new Map<string, TableEndpoint>();
  const tableFrames = new Map(
    frames.flatMap((frame) =>
      frame.cluster.tables.map((table) => [erTableKey(table.schema, table.name), frame] as const),
    ),
  );
  const obstacles = new Map<string, ErObstacle[]>();
  const keys = new Set<ForeignKeyInfo>();
  for (const frame of frames) {
    for (const fk of frame.cluster.relatedForeignKeys) keys.add(fk);
    if (!expanded.has(frame.cluster.id)) continue;
    const tables = loaded.get(frame.cluster.id) ?? [];
    obstacles.set(
      frame.cluster.id,
      tables.map((node) => ({
        ...node.position,
        width: NODE_WIDTH,
        height: node.height ?? HEADER_HEIGHT,
      })),
    );
    for (const node of tables) nodes.set(node.id, { node, frame });
  }
  const connections = new Map<string, Connection>();
  for (const edge of buildEdges([...keys])) {
    const source = nodes.get(edge.source);
    const target = nodes.get(edge.target);
    const sourceFrame = source?.frame ?? tableFrames.get(edge.source);
    const targetFrame = target?.frame ?? tableFrames.get(edge.target);
    if (!sourceFrame || !targetFrame || (!source && !target && sourceFrame === targetFrame))
      continue;
    const id =
      source && target
        ? edge.id
        : "cluster-link:" +
          JSON.stringify([
            source?.node.id ?? sourceFrame.cluster.id,
            target?.node.id ?? targetFrame.cluster.id,
          ]);
    const highlighted = selected.has(edge.source) || selected.has(edge.target);
    const existing = connections.get(id);
    if (existing) {
      existing.count++;
      existing.highlighted ||= highlighted;
    } else
      connections.set(id, {
        edge: { ...edge, id },
        source,
        target,
        sourceFrame,
        targetFrame,
        count: 1,
        highlighted,
      });
  }
  const columnRight = new Map<number, number>();
  const rowBottom = new Map<number, number>();
  for (const frame of frames) {
    columnRight.set(
      frame.position.x,
      Math.max(columnRight.get(frame.position.x) ?? 0, frame.position.x + frame.width),
    );
    rowBottom.set(
      frame.position.y,
      Math.max(rowBottom.get(frame.position.y) ?? 0, frame.position.y + frame.height),
    );
  }
  const previousLocal = new Map<string, ErPoint[][]>();
  const edges: Edge[] = [];
  const translate = (points: ErPoint[], frame: ErClusterFrame) =>
    points.map((point) => ({ x: point.x + frame.position.x, y: point.y + frame.position.y }));
  for (const {
    edge,
    source,
    target,
    sourceFrame,
    targetFrame,
    count,
    highlighted,
  } of connections.values()) {
    const from = source
      ? endpoint(source.node, edge.sourceHandle, true)
      : { x: sourceFrame.width + 4, y: sourceFrame.height / 2 };
    const to = target
      ? endpoint(target.node, edge.targetHandle, false)
      : { x: -4, y: targetFrame.height / 2 };
    let points: ErPoint[];
    if (sourceFrame === targetFrame) {
      const routes = previousLocal.get(sourceFrame.cluster.id) ?? [];
      const key = JSON.stringify([sourceFrame.cluster.id, from, to]);
      const route =
        routeCache.get(key) ??
        routeRelationship(from, to, obstacles.get(sourceFrame.cluster.id) ?? [], routes);
      if (!route) continue;
      routeCache.set(key, route);
      routes.push(route);
      previousLocal.set(sourceFrame.cluster.id, routes);
      points = translate(route, sourceFrame);
    } else {
      const sourceExit = { x: sourceFrame.width + CLUSTER_GAP / 3, y: from.y };
      const targetEntry = { x: -CLUSTER_GAP / 3, y: to.y };
      const outgoingKey = JSON.stringify([sourceFrame.cluster.id, from, sourceExit]);
      const incomingKey = JSON.stringify([targetFrame.cluster.id, targetEntry, to]);
      const outgoing =
        routeCache.get(outgoingKey) ??
        routeRelationship(from, sourceExit, obstacles.get(sourceFrame.cluster.id) ?? []);
      const incoming =
        routeCache.get(incomingKey) ??
        routeRelationship(targetEntry, to, obstacles.get(targetFrame.cluster.id) ?? []);
      const globalFrom = translate([sourceExit], sourceFrame)[0];
      const globalTo = translate([targetEntry], targetFrame)[0];
      let hash = 0;
      for (const character of edge.id) hash = (hash * 31 + character.charCodeAt(0)) | 0;
      const lane = ((Math.abs(hash) % 5) - 2) * 12;
      const sourceX =
        (columnRight.get(sourceFrame.position.x) ?? sourceFrame.position.x + sourceFrame.width) +
        CLUSTER_GAP / 2 +
        lane;
      const targetX = targetFrame.position.x - CLUSTER_GAP / 2 + lane;
      const channelY =
        (rowBottom.get(sourceFrame.position.y) ?? sourceFrame.position.y + sourceFrame.height) +
        CLUSTER_GAP / 2 +
        lane;
      const middle = [
        globalFrom,
        { x: sourceX, y: globalFrom.y },
        { x: sourceX, y: channelY },
        { x: targetX, y: channelY },
        { x: targetX, y: globalTo.y },
        globalTo,
      ];
      if (!outgoing || !incoming) continue;
      routeCache.set(outgoingKey, outgoing);
      routeCache.set(incomingKey, incoming);
      points = [
        ...translate(outgoing, sourceFrame),
        ...middle.slice(1, -1),
        ...translate(incoming, targetFrame),
      ];
    }
    const label =
      source && target
        ? `${edge.source}: ${edge.label} (${edge.target})`
        : (source?.node.data.label ?? sourceFrame.cluster.label) +
          " → " +
          (target?.node.data.label ?? targetFrame.cluster.label) +
          " · " +
          count +
          " FK";
    edges.push({
      ...edge,
      source: source?.node.id ?? sourceFrame.cluster.id,
      target: target?.node.id ?? targetFrame.cluster.id,
      sourceHandle: source ? edge.sourceHandle : "cluster-source",
      targetHandle: target ? edge.targetHandle : "cluster-target",
      type: "erRelationship",
      animated: false,
      label: undefined,
      ariaLabel: label,
      data: { points, highlighted, label, count },
      style: {
        ...edge.style,
        strokeWidth: highlighted && !exporting ? 2.5 : 1.4,
        opacity: selected.size === 0 || highlighted || exporting ? 0.8 : 0.2,
        vectorEffect: "non-scaling-stroke",
      },
      selectable: false,
      deletable: false,
    });
  }
  return edges;
}
