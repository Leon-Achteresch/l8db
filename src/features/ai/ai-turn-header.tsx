import { ChevronRight, CircleStop, ListChecks, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { ThinkingShimmer } from "./beui/agents/loading-states";

function duration(ms: number) {
  if (ms < 1000) return "unter 1 s";
  if (ms < 10_000) return `${(ms / 1000).toFixed(1).replace(".", ",")} s`;
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

export function AiTurnHeader({
  streaming,
  startedAt,
  durationMs,
  stopped,
  steps,
  open,
  onToggle,
}: {
  streaming: boolean;
  startedAt?: number;
  durationMs?: number;
  stopped?: boolean;
  steps: number;
  open?: boolean;
  onToggle?: () => void;
}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!streaming) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [streaming]);
  const elapsed = startedAt ? Math.floor((now - startedAt) / 1000) * 1000 : 0;
  const count = steps === 1 ? "1 Schritt" : `${steps} Schritte`;
  const label = streaming
    ? elapsed >= 1000
      ? `Arbeitet · ${duration(elapsed)}`
      : "Arbeitet …"
    : stopped
      ? durationMs !== undefined
        ? `Gestoppt nach ${duration(durationMs)}`
        : "Gestoppt"
      : `${steps ? `${count} · ` : ""}${duration(durationMs ?? 0)}`;
  const Icon = streaming ? LoaderCircle : stopped ? CircleStop : ListChecks;
  return (
    <button
      type="button"
      disabled={!onToggle}
      aria-expanded={onToggle ? open : undefined}
      onClick={onToggle}
      className={cn(
        "-ml-1.5 flex h-7 items-center gap-1.5 rounded-full px-2 text-[12px] tabular-nums text-muted-foreground outline-none transition-colors enabled:hover:bg-muted enabled:hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default",
        stopped && !streaming && "text-destructive/90 enabled:hover:text-destructive",
      )}
    >
      <Icon
        className={cn(
          "size-3.5 shrink-0",
          streaming && "animate-spin text-primary motion-reduce:animate-none",
        )}
      />
      {streaming ? <ThinkingShimmer className="font-normal">{label}</ThinkingShimmer> : label}
      {onToggle && (
        <ChevronRight
          className={cn("size-3 shrink-0 transition-transform duration-200", open && "rotate-90")}
        />
      )}
    </button>
  );
}
