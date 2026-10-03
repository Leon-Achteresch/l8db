import { applyNodeChanges, type NodeChange, Position } from "@xyflow/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { buildNodes } from "@/features/er-diagram/er-diagram-view/build-graph";
import {
  buildClusterFrames,
  type ErClusterFrame,
  fitClusterLayout,
} from "@/features/er-diagram/er-diagram-view/cluster-layout";
import {
  CLUSTER_HEADER_HEIGHT,
  HEADER_HEIGHT,
  NODE_WIDTH,
  ROW_HEIGHT,
} from "@/features/er-diagram/er-diagram-view/constants";
import { estimateNodeHeight } from "@/features/er-diagram/er-diagram-view/node-dimensions";
import { buildRoutedEdges } from "@/features/er-diagram/er-diagram-view/route-edges";
import type { ErPoint } from "@/features/er-diagram/er-diagram-view/route-relationship";
import type {
  ClusterNodeType,
  ErNodeType,
  TableNodeType,
} from "@/features/er-diagram/er-diagram-view/types";
import type { ERSchema } from "@/lib/db";
import { buildErClusters, erForeignKeyKey } from "@/lib/er-clusters";

async function loadClusterNodes(frame: ErClusterFrame): Promise<TableNodeType[]> {
  let positions = frame.positions;
  if (frame.cluster.foreignKeys.length > 0 && frame.cluster.tables.length > 1) {
    try {
      const { computeElkLayout } = await import("@/features/er-diagram/er-diagram-view/layout");
      positions = fitClusterLayout(
        frame,
        await computeElkLayout(frame.cluster.tables, frame.cluster.foreignKeys),
      );
    } catch {
      positions = frame.positions;
    }
  }
  return buildNodes(frame.cluster.tables, frame.cluster.relatedForeignKeys, positions).map(
    (node, index) => ({
      ...node,
      parentId: frame.cluster.id,
      extent: [
        [0, CLUSTER_HEADER_HEIGHT],
        [frame.width, frame.height],
      ],
      width: NODE_WIDTH,
      height: estimateNodeHeight(frame.cluster.tables[index]),
      handles: node.data.columns.flatMap((column, index) => {
        const y = HEADER_HEIGHT + index * (ROW_HEIGHT + 1) + ROW_HEIGHT / 2 - 4;
        return [
          ...(column.isTarget
            ? [
                {
                  id: `${column.name}-target`,
                  type: "target" as const,
                  position: Position.Left,
                  x: -8,
                  y,
                  width: 8,
                  height: 8,
                },
              ]
            : []),
          ...(column.isForeignKey
            ? [
                {
                  id: `${column.name}-source`,
                  type: "source" as const,
                  position: Position.Right,
                  x: NODE_WIDTH,
                  y,
                  width: 8,
                  height: 8,
                },
              ]
            : []),
        ];
      }),
      style: { width: NODE_WIDTH },
      deletable: false,
      connectable: false,
      draggable: false,
    }),
  );
}

export function useClusterGraph(schema: ERSchema | undefined, exporting: boolean) {
  const { clusters } = useMemo(
    () => buildErClusters(schema ?? { tables: [], foreign_keys: [] }),
    [schema],
  );
  const frames = useMemo(() => buildClusterFrames(clusters), [clusters]);
  const { layoutCache, savedPositions, routeCache } = useMemo(
    () => ({
      layoutCache: new Map<string, Promise<TableNodeType[]> | undefined>(
        frames.map((frame) => [frame.cluster.id, undefined]),
      ),
      savedPositions: new Map(frames.map((frame) => [frame.cluster.id, frame.position])),
      routeCache: new Map<string, ErPoint[]>(),
    }),
    [frames],
  );
  const [visibility, setVisibility] = useState<{ frames: ErClusterFrame[]; ids: string[] }>({
    frames,
    ids: [],
  });
  const [loaded, setLoaded] = useState<{
    frames: ErClusterFrame[];
    nodes: Map<string, TableNodeType[]>;
  }>({ frames, nodes: new Map() });
  const [nodes, setNodes] = useState<ErNodeType[]>([]);
  const visibleIds = useMemo(
    () => (visibility.frames === frames ? visibility.ids : []),
    [visibility, frames],
  );
  const activeIds = useMemo(
    () => new Set(exporting ? clusters.map((cluster) => cluster.id) : visibleIds),
    [exporting, clusters, visibleIds],
  );
  const loadedNodes = useMemo(
    () => (loaded.frames === frames ? loaded.nodes : new Map<string, TableNodeType[]>()),
    [loaded, frames],
  );

  const ensureLayouts = useCallback(
    async (ids: Set<string>) => {
      const entries = await Promise.all(
        frames
          .filter((frame) => ids.has(frame.cluster.id))
          .map(async (frame) => {
            let pending = layoutCache.get(frame.cluster.id);
            if (!pending) {
              pending = loadClusterNodes(frame);
              layoutCache.set(frame.cluster.id, pending);
            }
            return [frame.cluster.id, await pending] as const;
          }),
      );
      return new Map(entries);
    },
    [frames, layoutCache],
  );

  useEffect(() => {
    if (activeIds.size === 0 || [...activeIds].every((id) => loadedNodes.has(id))) return;
    let cancelled = false;
    void ensureLayouts(activeIds).then((ready) => {
      if (cancelled) return;
      setLoaded((current) => ({
        frames,
        nodes: new Map([...(current.frames === frames ? current.nodes : []), ...ready]),
      }));
    });
    return () => {
      cancelled = true;
    };
  }, [activeIds, loadedNodes, ensureLayouts, frames]);

  const expandedIds = useMemo(
    () => new Set([...activeIds].filter((id) => loadedNodes.has(id))),
    [activeIds, loadedNodes],
  );

  useEffect(() => {
    const frameNodes: ClusterNodeType[] = frames.map((frame) => ({
      id: frame.cluster.id,
      type: "clusterNode",
      position: frame.position,
      width: frame.width,
      height: frame.height,
      measured: { width: frame.width, height: frame.height },
      handles: [
        {
          id: "cluster-target",
          type: "target",
          position: Position.Left,
          x: -3,
          y: frame.height / 2 - 3,
          width: 6,
          height: 6,
        },
        {
          id: "cluster-source",
          type: "source",
          position: Position.Right,
          x: frame.width - 3,
          y: frame.height / 2 - 3,
          width: 6,
          height: 6,
        },
      ],
      style: { width: frame.width, height: frame.height },
      draggable: false,
      selectable: false,
      deletable: false,
      connectable: false,
      focusable: false,
      data: {
        label: frame.cluster.label,
        schema: [...new Set(frame.cluster.tables.map((table) => table.schema))].join(", "),
        tableCount: frame.cluster.tables.length,
        relationCount: new Set(frame.cluster.foreignKeys.map(erForeignKeyKey)).size,
        preview: frame.cluster.tables.slice(0, 4).map((table) => table.name),
        isolated: frame.cluster.isolated,
        expanded: expandedIds.has(frame.cluster.id),
        loading: activeIds.has(frame.cluster.id) && !expandedIds.has(frame.cluster.id),
      },
    }));
    const tableNodes = frames.flatMap((frame) =>
      expandedIds.has(frame.cluster.id) ? (loadedNodes.get(frame.cluster.id) ?? []) : [],
    );
    setNodes((current) => {
      const previous = new Map(current.map((node) => [node.id, node]));
      return [...frameNodes, ...tableNodes].map((node) => ({
        ...node,
        position: savedPositions.get(node.id) ?? node.position,
        selected: previous.get(node.id)?.selected,
        measured: previous.get(node.id)?.measured ?? node.measured,
      }));
    });
  }, [frames, activeIds, expandedIds, loadedNodes, savedPositions]);

  const selectedKeys = JSON.stringify(
    nodes
      .filter((node) => node.type === "tableNode" && node.selected)
      .map((node) => node.id)
      .sort(),
  );
  const edges = useMemo(
    () =>
      buildRoutedEdges(
        frames,
        loadedNodes,
        expandedIds,
        new Set<string>(JSON.parse(selectedKeys)),
        exporting,
        routeCache,
      ),
    [frames, loadedNodes, expandedIds, selectedKeys, exporting, routeCache],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<ErNodeType>[]) => {
      for (const change of changes) {
        if (change.type === "position" && change.position)
          savedPositions.set(change.id, change.position);
      }
      setNodes((current) => applyNodeChanges(changes, current));
    },
    [savedPositions],
  );

  const onVisibilityChange = useCallback(
    (ids: string[]) => {
      setVisibility({ frames, ids });
    },
    [frames],
  );

  const prepareExport = useCallback(async () => {
    const ready = await ensureLayouts(new Set(clusters.map((cluster) => cluster.id)));
    setLoaded({ frames, nodes: ready });
  }, [ensureLayouts, clusters, frames]);

  return { nodes, edges, clusters, onNodesChange, onVisibilityChange, prepareExport };
}
