import type { NodeProps } from "@xyflow/react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { StepGraphCard } from "./step-graph-card";
import { StepGraphHandles } from "./step-graph-handles";
import { STEP_HEIGHT, STEP_WIDTH, type StepFlowNode, statusTone } from "./step-graph-types";

export function StepGraphStepNode({ data }: NodeProps<Extract<StepFlowNode, { type: "step" }>>) {
  const [enter] = useState(data.fresh);
  return (
    <div
      data-testid={`automation-step-node-${data.step.id}`}
      data-selected={data.selected}
      className={cn(
        "group/node relative flex rounded-xl border bg-card shadow-xs transition-[border-color,box-shadow] duration-150",
        data.selected ? "border-primary ring-2 ring-primary/30" : "hover:border-foreground/20",
        !data.step.enabled && "border-dashed bg-card/70",
        !data.selected && statusTone(data.status),
        enter && "animate-in duration-200 ease-out fade-in-0 zoom-in-95 motion-reduce:zoom-in-100",
      )}
      style={{ width: STEP_WIDTH, height: STEP_HEIGHT }}
    >
      <StepGraphCard data={data} />
      <StepGraphHandles step={data.step} />
    </div>
  );
}
