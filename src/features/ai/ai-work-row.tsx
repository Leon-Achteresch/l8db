import { ChevronRight, LoaderCircle, type LucideIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { cn } from "@/lib/utils";
import { ThinkingShimmer } from "./beui/agents/loading-states";

export type AiStationTone = "idle" | "active" | "failed" | "allowed" | "denied" | "lead";

const ICON: Record<AiStationTone, string> = {
  idle: "text-muted-foreground",
  active: "text-primary",
  failed: "text-destructive/80",
  allowed: "text-amber-600 dark:text-amber-400",
  denied: "text-destructive/80",
  lead: "text-muted-foreground",
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
  const Glyph = station === "active" ? LoaderCircle : Icon;
  return (
    <div>
      <button
        type="button"
        disabled={!interactive}
        aria-expanded={interactive ? open : undefined}
        onClick={() => (onToggle ? onToggle() : setOwn(!own))}
        className="group/work -ml-1.5 flex min-h-7 max-w-[calc(100%+0.375rem)] select-none items-center gap-2 rounded-lg px-1.5 text-left text-[12.5px] leading-relaxed outline-none transition-colors enabled:hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
      >
        {Glyph && (
          <Glyph
            className={cn(
              "size-3.5 shrink-0",
              ICON[station],
              station === "active" && "animate-spin motion-reduce:animate-none",
            )}
          />
        )}
        <span
          className={cn(
            "min-w-0 truncate text-muted-foreground",
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
      </button>
      {open && detail && typeof detail === "string" && (
        <div className="mt-1 mb-2 max-h-64 overflow-auto rounded-xl bg-muted/60 px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-foreground/80">
          {detail}
        </div>
      )}
      {open && detail && typeof detail !== "string" && <div className="mt-1 mb-2">{detail}</div>}
    </div>
  );
}
