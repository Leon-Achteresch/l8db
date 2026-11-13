import { Check, ChevronRight, LoaderCircle, type LucideIcon, X } from "lucide-react";
import { type ReactNode, useState } from "react";
import { cn } from "@/lib/utils";
import { ThinkingShimmer } from "./beui/agents/loading-states";

export type AiStationTone = "idle" | "active" | "done" | "failed" | "allowed" | "denied" | "lead";

const NODE: Record<AiStationTone, string> = {
  idle: "bg-muted-foreground/10",
  active: "",
  done: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  failed: "bg-destructive/12 text-destructive",
  allowed: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  denied: "bg-destructive/12 text-destructive",
  lead: "bg-muted-foreground/12 text-muted-foreground",
};

function StepNode({ station }: { station: AiStationTone }) {
  if (station === "active")
    return (
      <LoaderCircle className="relative z-10 size-4 shrink-0 animate-spin text-blue-500 motion-reduce:animate-none" />
    );
  const Mark = station === "failed" || station === "denied" ? X : station === "idle" ? null : Check;
  return (
    <span
      className={cn(
        "relative z-10 grid size-4 shrink-0 place-items-center rounded-full ring-2 ring-background",
        NODE[station],
      )}
    >
      {Mark && <Mark className="size-2.5" strokeWidth={3} />}
    </span>
  );
}

export function AiWorkRow({
  icon: Icon,
  label,
  active = false,
  failed = false,
  tone,
  badge,
  meta,
  detail,
  onToggle,
  open: controlled,
}: {
  icon?: LucideIcon;
  label: ReactNode;
  active?: boolean;
  failed?: boolean;
  tone?: AiStationTone;
  badge?: ReactNode;
  meta?: ReactNode;
  detail?: ReactNode;
  onToggle?: () => void;
  open?: boolean;
}) {
  const [own, setOwn] = useState(false);
  const open = controlled ?? own;
  const station = active ? "active" : (tone ?? (failed ? "failed" : "idle"));
  const interactive = Boolean(detail || onToggle);
  return (
    <div
      data-step
      className="relative before:absolute before:top-0 before:left-[7.5px] before:hidden before:h-2 before:w-px before:bg-muted-foreground/25 before:content-[''] after:absolute after:top-5 after:bottom-0 after:left-[7.5px] after:hidden after:w-px after:bg-muted-foreground/25 after:content-[''] [[data-step]+&]:before:block [&:has(+[data-step])]:after:block"
    >
      <button
        type="button"
        disabled={!interactive}
        aria-expanded={interactive ? open : undefined}
        onClick={() => (onToggle ? onToggle() : setOwn(!own))}
        className="group/work -ml-1.5 flex min-h-7 w-[calc(100%+0.375rem)] select-none items-center gap-2 rounded-lg px-1.5 text-left text-[12.5px] leading-relaxed outline-none transition-colors enabled:hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
      >
        <StepNode station={station} />
        {Icon && (
          <Icon
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground/80",
              station === "active" && "text-foreground",
            )}
          />
        )}
        <span
          className={cn(
            "min-w-0 truncate text-muted-foreground",
            station === "active" && "text-foreground",
            (station === "failed" || station === "denied") && "text-destructive/90",
          )}
        >
          {active ? <ThinkingShimmer className="font-normal">{label}</ThinkingShimmer> : label}
        </span>
        {badge}
        {interactive && (
          <ChevronRight
            className={cn(
              "size-3 shrink-0 text-muted-foreground opacity-0 transition-[transform,opacity] duration-200 group-hover/work:opacity-100 group-focus-visible/work:opacity-100",
              open && "rotate-90 opacity-100",
            )}
          />
        )}
        {meta && <span className="ml-auto flex shrink-0 items-center">{meta}</span>}
      </button>
      {open && detail && typeof detail === "string" && (
        <div className="mt-1 mb-2 ml-6 max-h-64 overflow-auto rounded-xl bg-muted/60 px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-foreground/80">
          {detail}
        </div>
      )}
      {open && detail && typeof detail !== "string" && (
        <div className="mt-1 mb-2 ml-6">{detail}</div>
      )}
    </div>
  );
}
