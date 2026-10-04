import type { NodeProps } from "@xyflow/react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { StepGraphCard } from "./step-graph-card";
import { StepGraphHandles } from "./step-graph-handles";
import { LOOP_HEADER, type StepFlowNode, statusTone } from "./step-graph-types";

export function StepGraphLoopNode({
  data,
  width,
  height,
}: NodeProps<Extract<StepFlowNode, { type: "loop" }>>) {
  const [enter] = useState(data.fresh);
  return (
    <div
      data-testid={`automation-step-node-${data.step.id}`}
      data-selected={data.selected}
      className={cn(
        "group/node relative rounded-2xl border border-violet-500/30 bg-violet-500/[0.035] transition-[border-color,box-shadow] duration-150 dark:bg-violet-400/[0.05]",
        data.selected ? "border-primary ring-2 ring-primary/30" : "hover:border-violet-500/50",
        !data.step.enabled && "border-dashed",
        !data.selected && statusTone(data.status),
        enter &&
          "animate-in duration-250 ease-smooth-out fade-in-0 zoom-in-96 motion-reduce:zoom-in-100",
      )}
      style={{ width, height }}
    >
      <div className="flex items-center" style={{ height: LOOP_HEADER - 8 }}>
        <StepGraphCard data={data} className="h-full rounded-2xl" />
      </div>
      <StepGraphHandles step={data.step} />
    </div>
  );
}
