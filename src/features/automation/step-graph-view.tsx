import { ReactFlowProvider } from "@xyflow/react";
import { StepGraphCanvas, type StepGraphProps } from "./step-graph-canvas";

export function StepGraphView(props: StepGraphProps) {
  return (
    <ReactFlowProvider>
      <StepGraphCanvas {...props} />
    </ReactFlowProvider>
  );
}
