import { StepGraphAddNode } from "./step-graph-add-node";
import { StepGraphEdge } from "./step-graph-edge";
import { StepGraphLoopNode } from "./step-graph-loop-node";
import { StepGraphStartNode } from "./step-graph-start-node";
import { StepGraphStepNode } from "./step-graph-step-node";
import { StepGraphTerminalNode } from "./step-graph-terminal-node";

export const stepNodeTypes = {
  step: StepGraphStepNode,
  loop: StepGraphLoopNode,
  start: StepGraphStartNode,
  terminal: StepGraphTerminalNode,
  add: StepGraphAddNode,
};

export const stepEdgeTypes = { flow: StepGraphEdge };
