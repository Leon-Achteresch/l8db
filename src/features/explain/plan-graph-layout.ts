import ELK from "elkjs/lib/elk-api.js";
import elkWorkerUrl from "elkjs/lib/elk-worker.min.js?url";

import {
  PLAN_NODE_HEIGHT,
  PLAN_NODE_WARNING_HEIGHT,
  PLAN_NODE_WIDTH,
} from "@/features/explain/plan-graph-types";
import type { PlanAnalysis } from "@/lib/explain-analysis";
import type { ExplainGraphDirection } from "@/lib/explain-view-prefs";

const elk = new ELK({ workerUrl: elkWorkerUrl });

export function planNodeHeight(warnings: number): number {
  return PLAN_NODE_HEIGHT + (warnings > 0 ? PLAN_NODE_WARNING_HEIGHT : 0);
}

export async function layoutPlanGraph(
  analysis: PlanAnalysis,
  direction: ExplainGraphDirection,
): Promise<Map<string, { x: number; y: number }>> {
  const laid = await elk.layout({
    id: "plan",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": direction,
      "elk.spacing.nodeNode": "28",
      "elk.layered.spacing.nodeNodeBetweenLayers": "56",
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
      "elk.edgeRouting": "POLYLINE",
    },
    children: analysis.ops.map((op) => ({
      id: op.id,
      width: PLAN_NODE_WIDTH,
      height: planNodeHeight(op.warnings.length),
    })),
    edges: analysis.ops.flatMap((op) =>
      op.parentId === null ? [] : [{ id: op.id, sources: [op.parentId], targets: [op.id] }],
    ),
  });
  const positions = new Map<string, { x: number; y: number }>();
  for (const child of laid.children ?? []) {
    positions.set(child.id, { x: child.x ?? 0, y: child.y ?? 0 });
  }
  return positions;
}
