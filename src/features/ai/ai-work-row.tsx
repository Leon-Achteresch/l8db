import { ChevronRight, type LucideIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { cn } from "@/lib/utils";
import { ThinkingShimmer } from "./beui/agents/loading-states";

export function AiWorkRow({
  icon: Icon,
  label,
  active = false,
  failed = false,
  detail,
}: {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  failed?: boolean;
  detail?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="w-full rounded-md px-0.5 py-0.5 transition-colors hover:bg-accent/20">
      <button
        type="button"
        disabled={!detail}
        aria-expanded={detail ? open : undefined}
        onClick={() => setOpen(!open)}
        className="flex min-h-6 w-full select-none items-center gap-1.5 rounded-md text-left text-sm leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
      >
        <span className="grid size-6 shrink-0 place-items-center">
          <Icon className={cn("size-4 text-muted-foreground", failed && "text-destructive/60")} />
        </span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          {active ? <ThinkingShimmer className="font-normal">{label}</ThinkingShimmer> : label}
        </span>
        {detail && (
          <ChevronRight
            className={cn(
              "size-3 shrink-0 text-muted-foreground opacity-70 transition-transform duration-200",
              open && "rotate-90",
            )}
          />
        )}
      </button>
      {open && detail && typeof detail === "string" && (
        <div className="ms-7 mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-muted/40 px-3 py-2 font-mono text-[11px] text-foreground/80">
          {detail}
        </div>
      )}
      {open && detail && typeof detail !== "string" && <div className="ms-7 mt-1">{detail}</div>}
    </div>
  );
}
