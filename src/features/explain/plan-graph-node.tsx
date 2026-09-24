import { Handle, type NodeProps, Position } from "@xyflow/react";

import { planNodeHeight } from "@/features/explain/plan-graph-layout";
import { PLAN_NODE_WIDTH, type PlanGraphNodeType } from "@/features/explain/plan-graph-types";
import { PlanWarningBadges } from "@/features/explain/plan-warning-badges";
import { formatCount, formatMetric, heatColor } from "@/lib/explain-analysis";

const HANDLE_CLASS = "!size-1.5 !min-h-0 !min-w-0 !border-0 !bg-muted-foreground/60";

export function PlanGraphNode({ data }: NodeProps<PlanGraphNodeType>) {
  const { op, share, totalShare, metric, direction, selected } = data;
  const vertical = direction === "DOWN";
  const heat = heatColor(share);
  return (
    <div
      className={`relative overflow-hidden rounded-md border bg-card text-left shadow-sm ${selected ? "border-primary ring-2 ring-primary/60" : "border-border"}`}
      style={{ width: PLAN_NODE_WIDTH, height: planNodeHeight(op.warnings.length) }}
    >
      <Handle
        type="target"
        position={vertical ? Position.Top : Position.Left}
        className={HANDLE_CLASS}
        isConnectable={false}
      />
      <div className="absolute inset-0" style={{ background: heat }} />
      <div className="relative flex h-full flex-col gap-0.5 px-2 py-1.5 text-[11px]">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-semibold" title={op.label}>
            {op.label}
          </span>
          <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">
            {Math.round(share * 100)} %
          </span>
        </div>
        <span className="truncate font-mono text-muted-foreground" title={op.target ?? undefined}>
          {op.target ?? " "}
        </span>
        <span className="truncate tabular-nums text-muted-foreground">
          selbst {formatMetric(op.self, metric)} · gesamt {formatMetric(op.total, metric)} (
          {Math.round(totalShare * 100)} %)
        </span>
        <span className="truncate tabular-nums text-muted-foreground">
          {op.actualRows !== null
            ? `${formatCount(op.actualRows)} Zeilen${op.estimatedRows !== null ? ` (geschätzt ${formatCount(op.estimatedRows)})` : ""}`
            : op.estimatedRows !== null
              ? `~${formatCount(op.estimatedRows)} Zeilen`
              : " "}
        </span>
        {op.warnings.length > 0 && (
          <div className="mt-0.5 overflow-hidden">
            <PlanWarningBadges warnings={op.warnings} />
          </div>
        )}
      </div>
      <Handle
        type="source"
        position={vertical ? Position.Bottom : Position.Right}
        className={HANDLE_CLASS}
        isConnectable={false}
      />
    </div>
  );
}
