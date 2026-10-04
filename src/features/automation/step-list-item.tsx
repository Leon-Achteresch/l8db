import { useSortable } from "@dnd-kit/react/sortable";
import {
  CornerDownRightIcon,
  GripVerticalIcon,
  RotateCwIcon,
  TimerIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { type KeyboardEvent, type ReactNode, useState } from "react";
import { STEP_CATALOG, STEP_GROUP_TONE } from "@/lib/automation/step-catalog";
import type { FlatStep } from "@/lib/automation/step-tree";
import type { Flow, Step } from "@/lib/db/automation";
import { cn } from "@/lib/utils";

interface Props {
  entry: FlatStep;
  group: string;
  selected: boolean;
  summary: string;
  errors: number;
  warnings: number;
  fresh?: boolean;
  onSelect: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  children?: ReactNode;
}

function target(flow: Flow, siblings: Step[]): string | null {
  if (flow.type !== "goto") return null;
  const index = siblings.findIndex((step) => step.id === flow.stepId);
  return index < 0 ? "?" : String(index + 1);
}

function flowBadges(step: Step, siblings: Step[]): string[] {
  const badges: string[] = [];
  const success = target(step.onSuccess, siblings);
  if (success) badges.push(`weiter → ${success}`);
  if (step.onSuccess.type === "end_success" && step.action.type !== "condition")
    badges.push("danach Ende");
  const failure = target(step.onFailure, siblings);
  if (failure) badges.push(`Fehler → ${failure}`);
  if (step.onFailure.type === "next") badges.push("Fehler → weiter");
  if (step.onFailure.type === "end_success") badges.push("Fehler → Ende ok");
  if (step.action.type === "condition") {
    const then = target(step.action.then, siblings);
    const otherwise = target(step.action.otherwise, siblings);
    badges.push(`dann ${then ?? (step.action.then.type === "next" ? "weiter" : "Ende")}`);
    badges.push(
      `sonst ${otherwise ?? (step.action.otherwise.type === "next" ? "weiter" : "Ende")}`,
    );
  }
  return badges;
}

export function StepListItem({
  entry,
  group,
  selected,
  summary,
  errors,
  warnings,
  fresh = false,
  onSelect,
  onKeyDown,
  children,
}: Props) {
  const { step, index, number, siblings } = entry;
  const catalog = STEP_CATALOG[step.action.type];
  const Icon = catalog.icon;
  const { ref, handleRef, isDragging } = useSortable({
    id: step.id,
    index,
    group,
    type: group,
    accept: [group],
  });
  const [enter] = useState(fresh);
  const badges = flowBadges(step, siblings);
  const status = errors
    ? `${errors} Fehler`
    : warnings
      ? `${warnings} ${warnings === 1 ? "Hinweis" : "Hinweise"}`
      : null;

  return (
    <li
      ref={ref}
      data-step-id={step.id}
      className={cn(
        "group/step relative list-none rounded-xl",
        enter &&
          "animate-in duration-200 fade-in-0 slide-in-from-top-1 motion-reduce:slide-in-from-top-0",
        isDragging && "z-20 bg-card shadow-lg ring-1 ring-border",
      )}
    >
      <div
        className={cn(
          "relative flex items-stretch gap-1 rounded-xl pr-2 transition-colors duration-150",
          selected ? "bg-accent" : "hover:bg-muted/60",
        )}
      >
        <button
          type="button"
          ref={handleRef}
          tabIndex={-1}
          aria-hidden
          title="Ziehen zum Verschieben (Tastatur: Alt + Pfeiltasten)"
          className="flex w-5 shrink-0 cursor-grab touch-none items-center justify-center rounded-l-xl text-muted-foreground/0 transition-colors group-hover/step:text-muted-foreground/60 hover:text-foreground! active:cursor-grabbing"
        >
          <GripVerticalIcon className="size-3.5" />
        </button>
        <button
          type="button"
          data-step-button={step.id}
          aria-current={selected ? "step" : undefined}
          aria-label={`Schritt ${number}: ${step.name || catalog.label}${status ? `, ${status}` : ""}${step.enabled ? "" : ", deaktiviert"}`}
          onClick={onSelect}
          onKeyDown={onKeyDown}
          className="flex min-w-0 flex-1 items-start gap-2.5 rounded-lg py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          <span className="relative mt-px shrink-0">
            <span
              className={cn(
                "grid size-7 place-items-center rounded-lg",
                STEP_GROUP_TONE[catalog.group],
                !step.enabled && "opacity-45 grayscale",
              )}
            >
              <Icon className="size-3.5" />
            </span>
            {(errors > 0 || warnings > 0) && (
              <span
                aria-hidden
                className={cn(
                  "absolute -top-1 -right-1 size-2.5 rounded-full ring-2 ring-background",
                  errors ? "bg-destructive" : "bg-amber-500",
                )}
              />
            )}
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="flex min-w-0 items-baseline gap-1.5">
              <span className="shrink-0 text-[11px] font-medium text-muted-foreground tabular-nums">
                {number}
              </span>
              <span
                className={cn(
                  "truncate text-[13px] font-medium",
                  !step.enabled &&
                    "text-muted-foreground line-through decoration-muted-foreground/40",
                )}
              >
                {step.name || catalog.label}
              </span>
              {catalog.risky && (step.action.type !== "unzip" || step.action.overwrite) && (
                <TriangleAlertIcon
                  className="size-3 shrink-0 self-center text-amber-600 dark:text-amber-400"
                  aria-hidden
                />
              )}
            </span>
            <span
              className={cn(
                "truncate text-xs",
                summary ? "text-muted-foreground" : "text-muted-foreground/70 italic",
              )}
            >
              {summary || "Noch nicht eingerichtet"}
            </span>
            {(badges.length > 0 || step.retry || step.timeoutSeconds) && (
              <span className="mt-0.5 flex flex-wrap gap-1">
                {badges.map((badge) => (
                  <span
                    key={badge}
                    className="inline-flex h-[18px] items-center gap-0.5 rounded-md bg-background/80 px-1.5 text-[11px] font-medium text-muted-foreground ring-1 ring-border/70"
                  >
                    <CornerDownRightIcon className="size-2.5" aria-hidden />
                    {badge}
                  </span>
                ))}
                {step.retry && step.retry.attempts > 0 && (
                  <span className="inline-flex h-[18px] items-center gap-0.5 rounded-md bg-background/80 px-1.5 text-[11px] font-medium text-muted-foreground tabular-nums ring-1 ring-border/70">
                    <RotateCwIcon className="size-2.5" aria-hidden />
                    {step.retry.attempts}×
                  </span>
                )}
                {step.timeoutSeconds && (
                  <span className="inline-flex h-[18px] items-center gap-0.5 rounded-md bg-background/80 px-1.5 text-[11px] font-medium text-muted-foreground tabular-nums ring-1 ring-border/70">
                    <TimerIcon className="size-2.5" aria-hidden />
                    {step.timeoutSeconds} s
                  </span>
                )}
              </span>
            )}
          </span>
        </button>
      </div>
      {children}
    </li>
  );
}
