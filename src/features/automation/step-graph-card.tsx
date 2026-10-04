import { RotateCwIcon, TimerIcon, TriangleAlertIcon } from "lucide-react";
import { runStatusLabel } from "@/lib/automation/format";
import { STEP_CATALOG, STEP_GROUP_TONE } from "@/lib/automation/step-catalog";
import { cn } from "@/lib/utils";
import { StatusIcon } from "./status-icon";
import { useStepGraph } from "./step-graph-context";
import type { StepNodeData } from "./step-graph-types";

interface Props {
  data: StepNodeData;
  className?: string;
}

function issueText(errors: number, warnings: number): string | null {
  if (errors) return `${errors} Fehler`;
  if (warnings) return `${warnings} ${warnings === 1 ? "Hinweis" : "Hinweise"}`;
  return null;
}

export function StepGraphCard({ data, className }: Props) {
  const { select, focus, keyDown } = useStepGraph();
  const { step, number, summary, selected, focusable, errors, warnings, status } = data;
  const catalog = STEP_CATALOG[step.action.type];
  const Icon = catalog.icon;
  const name = step.name || catalog.label;
  const issues = issueText(errors, warnings);
  const retry = step.retry && step.retry.attempts > 0 ? step.retry.attempts : null;
  const label = [
    `Schritt ${number}`,
    catalog.label,
    name !== catalog.label ? name : null,
    issues,
    step.enabled ? null : "deaktiviert",
    status ? runStatusLabel(status) : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <button
      type="button"
      data-graph-step={step.id}
      tabIndex={focusable ? 0 : -1}
      aria-label={label}
      aria-current={selected ? "step" : undefined}
      onClick={() => select(step.id)}
      onFocus={() => focus(step.id)}
      onKeyDown={(event) => keyDown(step.id, event)}
      className={cn(
        "flex w-full min-w-0 items-center gap-2.5 rounded-xl px-2.5 text-left outline-none",
        "focus-visible:ring-2 focus-visible:ring-ring/60",
        className,
      )}
    >
      <span className="relative shrink-0">
        <span
          className={cn(
            "grid size-8 place-items-center rounded-lg",
            STEP_GROUP_TONE[catalog.group],
            !step.enabled && "opacity-45 grayscale",
          )}
        >
          <Icon className="size-4" />
        </span>
        {issues && (
          <span
            aria-hidden
            className={cn(
              "absolute -top-1 -right-1 size-2.5 rounded-full ring-2 ring-card",
              errors ? "bg-destructive" : "bg-amber-500",
            )}
          />
        )}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="shrink-0 text-[11px] font-medium text-muted-foreground tabular-nums">
            {number}
          </span>
          <span
            className={cn(
              "truncate text-[13px] leading-5 font-medium",
              !step.enabled && "text-muted-foreground line-through decoration-muted-foreground/40",
            )}
          >
            {name}
          </span>
          <span className="ml-auto flex shrink-0 items-center gap-1 pl-1 text-[11px] font-medium text-muted-foreground tabular-nums">
            {retry && (
              <span className="inline-flex items-center gap-0.5" title={`${retry} Wiederholungen`}>
                <RotateCwIcon className="size-2.5" aria-hidden />
                {retry}×
              </span>
            )}
            {step.timeoutSeconds && (
              <span
                className="inline-flex items-center gap-0.5"
                title={`Timeout ${step.timeoutSeconds} s`}
              >
                <TimerIcon className="size-2.5" aria-hidden />
                {step.timeoutSeconds} s
              </span>
            )}
            {issues && (
              <span
                className={cn(
                  "inline-flex items-center gap-0.5",
                  errors ? "text-destructive" : "text-amber-600 dark:text-amber-400",
                )}
                title={issues}
              >
                <TriangleAlertIcon className="size-2.5" aria-hidden />
                {errors || warnings}
              </span>
            )}
            {status && <StatusIcon status={status} className="size-3.5" />}
          </span>
        </span>
        <span
          className={cn(
            "truncate text-[11px] leading-4",
            summary ? "text-muted-foreground" : "text-muted-foreground/70 italic",
          )}
        >
          {step.enabled ? summary || "Noch nicht eingerichtet" : "Übersprungen"}
        </span>
      </span>
    </button>
  );
}
