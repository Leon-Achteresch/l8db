import { Handle, type NodeProps, Position } from "@xyflow/react";
import { OctagonXIcon, RepeatIcon, SquareCheckIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { SMALL_HEIGHT, SMALL_WIDTH, type StepFlowNode } from "./step-graph-types";

const HANDLE = "!size-1.5 !min-h-0 !min-w-0 !border-0 !bg-transparent";

export function StepGraphTerminalNode({
  data,
}: NodeProps<Extract<StepFlowNode, { type: "terminal" }>>) {
  const { kind, nested, item } = data;
  const Icon =
    kind === "entry" ? RepeatIcon : kind === "end_success" ? SquareCheckIcon : OctagonXIcon;
  const label =
    kind === "entry"
      ? `Für jedes „${item}“`
      : kind === "end_success"
        ? nested
          ? "Durchlauf beenden"
          : "Erfolgreich beenden"
        : nested
          ? "Durchlauf mit Fehler"
          : "Mit Fehler beenden";

  return (
    <div
      role="img"
      aria-label={label}
      className={cn(
        "flex items-center justify-center gap-1.5 rounded-full border px-3 text-[11px] font-medium",
        kind === "entry" && "border-violet-500/25 bg-card text-violet-700 dark:text-violet-300",
        kind === "end_success" &&
          "border-emerald-500/35 bg-emerald-500/8 text-emerald-700 dark:text-emerald-300",
        kind === "end_failure" &&
          "border-destructive/35 bg-destructive/8 text-red-700 dark:text-red-300",
      )}
      style={{ width: SMALL_WIDTH, height: SMALL_HEIGHT }}
    >
      {kind !== "entry" && (
        <Handle
          type="target"
          position={Position.Top}
          isConnectableStart={false}
          className={HANDLE}
        />
      )}
      <Icon className="size-3.5 shrink-0" aria-hidden />
      <span className="truncate">{label}</span>
      {kind === "entry" && (
        <Handle
          type="source"
          id="success"
          position={Position.Bottom}
          isConnectable={false}
          className={HANDLE}
        />
      )}
    </div>
  );
}
