import { Handle, type NodeProps, Position, type ReactFlowState, useStore } from "@xyflow/react";
import { KeyRound } from "lucide-react";
import { useContext } from "react";
import { COMPACT_ZOOM, ROW_HEIGHT } from "@/features/er-diagram/er-diagram-view/constants";
import { ErFullDetailContext } from "@/features/er-diagram/er-diagram-view/er-detail-context";
import type { TableNodeType } from "@/features/er-diagram/er-diagram-view/types";

const zoomedOut = (state: ReactFlowState) => state.transform[2] < COMPACT_ZOOM;
const ROW_PITCH = ROW_HEIGHT + 1;
const HANDLE_CLASS = "!w-2 !h-2 !bg-primary !border-primary-foreground";

export function TableNode({ data }: NodeProps<TableNodeType>) {
  const fullDetail = useContext(ErFullDetailContext);
  const compact = useStore(zoomedOut) && !fullDetail;
  return (
    <div className="min-w-[220px] rounded-lg border border-border bg-card shadow-md overflow-hidden">
      <div className="bg-primary px-3 py-2 text-primary-foreground font-semibold text-sm flex items-center gap-2">
        <span className="truncate">{data.label}</span>
        <span className="ml-auto text-[10px] font-normal opacity-70">{data.schema}</span>
      </div>
      {compact ? (
        <div className="relative" style={{ height: data.columns.length * ROW_PITCH - 1 }}>
          {data.columns.map((col, index) =>
            col.isTarget || col.isForeignKey ? (
              <div
                key={col.name}
                className="absolute inset-x-0"
                style={{ top: index * ROW_PITCH, height: ROW_HEIGHT }}
              >
                {col.isTarget && (
                  <Handle
                    type="target"
                    position={Position.Left}
                    id={`${col.name}-target`}
                    className={`${HANDLE_CLASS} !-left-1`}
                  />
                )}
                {col.isForeignKey && (
                  <Handle
                    type="source"
                    position={Position.Right}
                    id={`${col.name}-source`}
                    className={`${HANDLE_CLASS} !-right-1`}
                  />
                )}
              </div>
            ) : null,
          )}
        </div>
      ) : (
        <div className="divide-y divide-border">
          {data.columns.map((col) => (
            <div
              key={col.name}
              className="relative px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-accent/50 transition-colors"
            >
              {col.isTarget && (
                <Handle
                  type="target"
                  position={Position.Left}
                  id={`${col.name}-target`}
                  className={`${HANDLE_CLASS} !-left-1`}
                />
              )}
              {col.isForeignKey && (
                <Handle
                  type="source"
                  position={Position.Right}
                  id={`${col.name}-source`}
                  className={`${HANDLE_CLASS} !-right-1`}
                />
              )}
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
      )}
    </div>
  );
}
