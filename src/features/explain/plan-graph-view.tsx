import { Background, BackgroundVariant, Controls, type Edge, ReactFlow } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { layoutPlanGraph } from "@/features/explain/plan-graph-layout";
import { planNodeTypes } from "@/features/explain/plan-graph-node-types";
import type { PlanGraphNodeType } from "@/features/explain/plan-graph-types";
import { formatCount, type PlanAnalysis, selfShare } from "@/lib/explain-analysis";
import { buildPlanEdges } from "@/lib/explain-graph";
import { useExplainViewPrefs } from "@/lib/explain-view-prefs";

interface PlanGraphViewProps {
  analysis: PlanAnalysis;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function PlanGraphView({ analysis, selectedId, onSelect }: PlanGraphViewProps) {
  const direction = useExplainViewPrefs((state) => state.direction);
  const [positions, setPositions] = useState<Map<string, { x: number; y: number }> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setPositions(null);
    layoutPlanGraph(analysis, direction)
      .then((laid) => {
        if (!cancelled) setPositions(laid);
      })
      .catch((reason) => {
        if (!cancelled) setError(String(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [analysis, direction]);

  const nodes = useMemo<PlanGraphNodeType[]>(
    () =>
      analysis.ops.map((op) => ({
        id: op.id,
        type: "planNode",
        position: positions?.get(op.id) ?? { x: 0, y: 0 },
        draggable: false,
        connectable: false,
        data: {
          op,
          share: selfShare(analysis, op),
          totalShare: analysis.total > 0 ? op.total / analysis.total : 0,
          metric: analysis.metric,
          direction,
          selected: op.id === selectedId,
        },
      })),
    [analysis, positions, direction, selectedId],
  );

  const edges = useMemo<Edge[]>(
    () =>
      buildPlanEdges(analysis).map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: edge.rows !== null ? formatCount(edge.rows) : undefined,
        labelStyle: { fontSize: 10 },
        labelBgStyle: { fill: "var(--color-card)" },
        style: { strokeWidth: edge.width, stroke: "var(--color-muted-foreground)" },
      })),
    [analysis],
  );

  if (error) {
    return <p className="p-3 text-xs text-destructive">Graph-Layout fehlgeschlagen: {error}</p>;
  }
  if (!positions) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        Layout wird berechnet…
      </div>
    );
  }
  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={planNodeTypes}
      onNodeClick={(_, node) => onSelect(node.id)}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      fitView
      fitViewOptions={{ padding: 0.15 }}
      minZoom={0.05}
      maxZoom={2}
      proOptions={{ hideAttribution: true }}
    >
      <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}
