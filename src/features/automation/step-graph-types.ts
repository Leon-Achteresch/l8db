import type { Edge, Node } from "@xyflow/react";
import type { GraphHandle, GraphInsert, StepGraphEdge } from "@/lib/automation/step-graph";
import type { RunStatus, Schedule, Step } from "@/lib/db/automation";

export type StepNodeData = {
  step: Step;
  number: string;
  summary: string;
  selected: boolean;
  focusable: boolean;
  errors: number;
  warnings: number;
  status: RunStatus | null;
  fresh: boolean;
};

export type StartNodeData = { schedules: Schedule[]; taskNames: Record<string, string> };
export type TerminalNodeData = {
  kind: "end_success" | "end_failure" | "entry";
  nested: boolean;
  item: string;
};
export type AddNodeData = { parentId: string };

export type StepFlowNode =
  | Node<StepNodeData, "step">
  | Node<StepNodeData, "loop">
  | Node<StartNodeData, "start">
  | Node<TerminalNodeData, "terminal">
  | Node<AddNodeData, "add">;

export type FlowEdgeData = {
  handle: GraphHandle;
  role: StepGraphEdge["role"];
  label: string | null;
  insert: GraphInsert | null;
  deletable: boolean;
  dropping: boolean;
  lane: number | null;
};

export type StepFlowEdge = Edge<FlowEdgeData, "flow">;

export const STEP_WIDTH = 252;
export const STEP_HEIGHT = 60;
export const SMALL_WIDTH = 176;
export const SMALL_HEIGHT = 30;
export const START_LINE = 17;
export const LOOP_HEADER = 64;
export const LOOP_PADDING = 18;
export const LOOP_LANE_PADDING = 76;
export const GOTO_COLOR = "oklch(0.62 0.15 237)";

export function statusTone(status: RunStatus | null): string {
  if (status === "running") return "border-primary ring-2 ring-primary/25";
  if (status === "success") return "border-emerald-500/60";
  if (status === "warning" || status === "interrupted") return "border-amber-500/60";
  if (status === "failed" || status === "timeout")
    return "border-destructive/70 ring-2 ring-destructive/15";
  return "";
}
