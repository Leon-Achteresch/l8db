import { ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

function duration(ms: number) {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))} ms`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(1).replace(".", ",")} s`;
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

export function AiTurnHeader({
  streaming,
  startedAt,
  durationMs,
  stopped,
  open,
  onToggle,
}: {
  streaming: boolean;
  startedAt?: number;
  durationMs?: number;
  stopped?: boolean;
  open?: boolean;
  onToggle?: () => void;
}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!streaming) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [streaming]);
  const label = streaming
    ? startedAt
      ? `Arbeitet seit ${duration(Math.floor((now - startedAt) / 1000) * 1000)}`
      : "Arbeitet …"
    : stopped
      ? durationMs !== undefined
        ? `Gestoppt nach ${duration(durationMs)}`
        : "Gestoppt"
      : `Gearbeitet für ${duration(durationMs ?? 0)}`;
  const className =
    "flex h-6 w-full items-center gap-1 px-1 text-left text-sm text-muted-foreground tabular-nums";
  return (
    <div className="border-b border-border/60 pt-1 pb-2">
      {onToggle ? (
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className={cn(
            className,
            "rounded-md outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          {label}
          <ChevronRight
            className={cn("size-3 transition-transform duration-200", open && "rotate-90")}
          />
        </button>
      ) : (
        <p className={className}>{label}</p>
      )}
    </div>
  );
}
