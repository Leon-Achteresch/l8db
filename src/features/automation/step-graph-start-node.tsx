import { Handle, type NodeProps, Position } from "@xyflow/react";
import { CalendarClockIcon, PlayIcon } from "lucide-react";
import { describeSchedule } from "@/lib/automation/schedule-text";
import { startHeight, startLines } from "./step-graph-layout";
import { STEP_WIDTH, type StepFlowNode } from "./step-graph-types";

export function StepGraphStartNode({ data }: NodeProps<Extract<StepFlowNode, { type: "start" }>>) {
  const active = data.schedules.filter((schedule) => schedule.enabled);
  const shown = active.slice(0, active.length > 3 ? 2 : 3);
  const rest = active.length - shown.length;

  return (
    <div
      className="flex flex-col justify-center gap-0.5 rounded-xl border border-dashed bg-background/80 px-3 text-left"
      style={{ width: STEP_WIDTH, height: startHeight(startLines(active.length)) }}
    >
      <span className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        <PlayIcon className="size-3 fill-current" aria-hidden />
        Start
      </span>
      {shown.length === 0 ? (
        <span className="truncate text-xs leading-[17px] text-muted-foreground">
          Manuell oder per CLI
        </span>
      ) : (
        shown.map((schedule) => (
          <span
            key={schedule.id}
            className="flex min-w-0 items-center gap-1.5 text-xs leading-[17px]"
          >
            <CalendarClockIcon className="size-3 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate" title={describeSchedule(schedule, data.taskNames)}>
              {describeSchedule(schedule, data.taskNames)}
            </span>
          </span>
        ))
      )}
      {rest > 0 && (
        <span className="text-xs leading-[17px] text-muted-foreground">
          + {rest} weitere Zeitpläne
        </span>
      )}
      <Handle
        type="source"
        id="success"
        position={Position.Bottom}
        isConnectable={false}
        className="!size-1.5 !min-h-0 !min-w-0 !border-0 !bg-muted-foreground/50"
      />
    </div>
  );
}
