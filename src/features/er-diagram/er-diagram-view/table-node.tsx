import { Handle, type NodeProps, Position } from "@xyflow/react";
import { KeyRound } from "lucide-react";
import type { TableNodeType } from "@/features/er-diagram/er-diagram-view/types";

export function TableNode({ data }: NodeProps<TableNodeType>) {
  return (
    <div className="min-w-[220px] rounded-lg border border-border bg-card shadow-md overflow-hidden">
      <div className="bg-primary px-3 py-2 text-primary-foreground font-semibold text-sm flex items-center gap-2">
        <span className="truncate">{data.label}</span>
        <span className="ml-auto text-[10px] font-normal opacity-70">{data.schema}</span>
      </div>
      <div className="divide-y divide-border">
        {data.columns.map((col) => (
          <div
            key={col.name}
            className="relative px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-accent/50 transition-colors"
          >
            <Handle
              type="target"
              position={Position.Left}
              id={`${col.name}-target`}
              className="!w-2 !h-2 !bg-primary !border-primary-foreground !-left-1"
            />
            <Handle
              type="source"
              position={Position.Right}
              id={`${col.name}-source`}
              className="!w-2 !h-2 !bg-primary !border-primary-foreground !-right-1"
            />
            <span className="flex items-center gap-1 font-medium min-w-0 shrink">
              {col.isPrimaryKey && <KeyRound className="size-3 text-amber-500 shrink-0" />}
              {col.isForeignKey && !col.isPrimaryKey && (
                <KeyRound className="size-3 text-blue-500 shrink-0" />
              )}
              <span className="truncate">{col.name}</span>
            </span>
            <span className="ml-auto text-muted-foreground whitespace-nowrap">
              {col.dataType}
              {!col.isNullable && <span className="ml-1 text-amber-500">*</span>}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
