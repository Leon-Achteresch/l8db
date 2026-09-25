import type { Node } from "@xyflow/react";

import type { PlanMetricKind, PlanOp } from "@/lib/explain-analysis";
import type { ExplainGraphDirection } from "@/lib/explain-view-prefs";

export type PlanGraphNodeData = {
  op: PlanOp;
  share: number;
  totalShare: number;
  metric: PlanMetricKind;
  direction: ExplainGraphDirection;
  selected: boolean;
};

export type PlanGraphNodeType = Node<PlanGraphNodeData, "planNode">;

export const PLAN_NODE_WIDTH = 230;
export const PLAN_NODE_HEIGHT = 76;
export const PLAN_NODE_WARNING_HEIGHT = 22;
