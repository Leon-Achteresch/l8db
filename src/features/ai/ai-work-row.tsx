import { ChevronRight, type LucideIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { cn } from "@/lib/utils";
import { ThinkingShimmer } from "./beui/agents/loading-states";

export type AiStationTone = "idle" | "active" | "failed" | "allowed" | "denied" | "lead";

const DOT: Record<AiStationTone, string> = {
  idle: "bg-muted-foreground/45",
  active: "bg-primary",
  failed: "bg-destructive",
  allowed: "bg-amber-500",
  denied: "bg-destructive",
  lead: "bg-background ring-[1.5px] ring-inset ring-muted-foreground/60",
};

export function AiWorkRow({
  icon: Icon,
  label,
  active = false,
  failed = false,
  tone,
  badge,
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
  detail?: ReactNode;
  onToggle?: () => void;
  open?: boolean;
}) {
  const [own, setOwn] = useState(false);
  const open = controlled ?? own;
  const station = tone ?? (active ? "active" : failed ? "failed" : "idle");
  const interactive = Boolean(detail || onToggle);
  return (
    <div className="relative">
      <span
        aria-hidden="true"
        className={cn(
          "absolute top-[9px] -left-[21px] size-[9px] rounded-full shadow-[0_0_0_3px_var(--background)]",
          DOT[station],
        )}
      >
        {station === "active" && (
          <span className="absolute inset-0 animate-ping rounded-full bg-primary/50 motion-reduce:animate-none" />
        )}
      </span>
      <button
        type="button"
        disabled={!interactive}
        aria-expanded={interactive ? open : undefined}
        onClick={() => (onToggle ? onToggle() : setOwn(!own))}
        className="-ml-1.5 flex min-h-7 w-[calc(100%+0.375rem)] select-none items-center gap-2 rounded-md px-1.5 text-left text-[13px] leading-relaxed outline-none transition-colors enabled:hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
      >
        {Icon && (
          <Icon
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground",
              station === "failed" && "text-destructive/70",
            )}
          />
        )}
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-muted-foreground",
            station === "failed" && "text-destructive/90",
          )}
        >
          {active ? <ThinkingShimmer className="font-normal">{label}</ThinkingShimmer> : label}
        </span>
        {badge}
        {interactive && (
          <ChevronRight
            className={cn(
              "size-3 shrink-0 text-muted-foreground/70 transition-transform duration-200",
              open && "rotate-90",
            )}
          />
        )}
      </button>
      {open && detail && typeof detail === "string" && (
        <div className="mt-1 mb-2 max-h-64 overflow-auto rounded-lg bg-muted/50 px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-foreground/80">
          {detail}
        </div>
      )}
      {open && detail && typeof detail !== "string" && <div className="mt-1 mb-2">{detail}</div>}
    </div>
  );
}
