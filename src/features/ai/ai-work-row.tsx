import { ChevronRight, type LucideIcon, X } from "lucide-react";
import { type ReactNode, useState } from "react";
import { cn } from "@/lib/utils";
import { ThinkingShimmer } from "./beui/agents/loading-states";

export type AiStationTone = "idle" | "active" | "done" | "failed" | "allowed" | "denied" | "lead";

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
  const error = station === "failed" || station === "denied";
  const interactive = Boolean(detail || onToggle);
  return (
    <div data-step>
      <button
        type="button"
        disabled={!interactive}
        aria-expanded={interactive ? open : undefined}
        onClick={() => (onToggle ? onToggle() : setOwn(!own))}
        className={cn(
          "flex min-h-6 w-full min-w-0 select-none items-center gap-1.5 rounded-md px-0.5 py-0.5 text-left text-sm leading-relaxed text-muted-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-inset enabled:cursor-pointer enabled:hover:text-foreground disabled:cursor-default",
          open && "text-foreground",
        )}
      >
        <span className="flex w-6 shrink-0 justify-center">
          {Icon && (
            <Icon
              className={cn(
                "size-4 shrink-0 opacity-70",
                error && "text-destructive/70",
                (active || open) && "opacity-100",
              )}
            />
          )}
        </span>
        <span className="min-w-0 truncate">
          {active ? <ThinkingShimmer className="font-normal">{label}</ThinkingShimmer> : label}
        </span>
        {station === "failed" && <X className="size-3 shrink-0 text-destructive/70" />}
        {badge}
        {interactive && (
          <ChevronRight
            className={cn(
              "size-3 shrink-0 opacity-0 transition-[transform,opacity] duration-200 [button:focus-visible>&]:opacity-100 [button:hover>&]:opacity-100",
              open && "rotate-90 opacity-100",
            )}
          />
        )}
        {meta && <span className="ml-auto flex shrink-0 items-center">{meta}</span>}
      </button>
      {open && detail && (
        <div
          className={cn(
            "mt-0.5 mb-1.5 ms-8 cursor-auto select-text",
            typeof detail === "string" &&
              "max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-muted/40 px-3 py-2 font-mono text-[11px] leading-relaxed text-foreground/80",
          )}
        >
          {detail}
        </div>
      )}
    </div>
  );
}
