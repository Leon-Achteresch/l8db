import { Handle, type NodeProps, Position } from "@xyflow/react";
import { PlusIcon } from "lucide-react";
import { StepAddMenu } from "./step-add-menu";
import { useStepGraph } from "./step-graph-context";
import { SMALL_HEIGHT, SMALL_WIDTH, type StepFlowNode } from "./step-graph-types";

export function StepGraphAddNode({ data }: NodeProps<Extract<StepFlowNode, { type: "add" }>>) {
  const { insert } = useStepGraph();
  return (
    <div style={{ width: SMALL_WIDTH, height: SMALL_HEIGHT }}>
      <Handle
        type="target"
        position={Position.Top}
        isConnectableStart={false}
        className="!size-1.5 !min-h-0 !min-w-0 !border-0 !bg-transparent"
      />
      <StepAddMenu onPick={(type) => insert({ parentId: data.parentId, index: Infinity }, type)}>
        <button
          type="button"
          data-testid={`automation-loop-add-${data.parentId}`}
          className="nodrag flex size-full items-center justify-center gap-1 rounded-full border border-dashed border-violet-500/35 bg-card text-[11px] font-medium text-muted-foreground transition-colors duration-150 outline-none hover:border-violet-500/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 active:scale-[0.97]"
        >
          <PlusIcon className="size-3.5" aria-hidden />
          Schritt in Schleife
        </button>
      </StepAddMenu>
    </div>
  );
}
