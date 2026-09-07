import { PauseIcon, RefreshCwIcon } from "lucide-react";

import {
  AUTO_REFRESH_INTERVALS,
  describeAutoRefreshInterval,
  normalizeAutoRefreshInterval,
} from "@/lib/auto-refresh";
import { cn } from "@/lib/utils";

type DataTableAutoRefreshProps = {
  intervalMs: number;
  pauseReason: string | null;
  onIntervalChange: (value: number) => void;
};

export function DataTableAutoRefresh({
  intervalMs,
  pauseReason,
  onIntervalChange,
}: DataTableAutoRefreshProps) {
  const isActive = intervalMs > 0;
  return (
    <div className="flex items-center gap-1.5">
      {isActive && pauseReason ? (
        <PauseIcon className="size-3 text-amber-500" />
      ) : (
        <RefreshCwIcon className={cn("size-3", isActive ? "text-primary" : "opacity-60")} />
      )}
      <select
        value={intervalMs}
        title={pauseReason ? `Pausiert: ${pauseReason}` : "Automatisch aktualisieren"}
        onChange={(e) => onIntervalChange(normalizeAutoRefreshInterval(Number(e.target.value)))}
        className="h-5 rounded border border-border bg-background px-1 text-[11px] text-muted-foreground outline-none cursor-pointer hover:bg-accent"
      >
        {AUTO_REFRESH_INTERVALS.map((value) => (
          <option key={value} value={value}>
            {value === 0
              ? "Auto-Aktualisierung: aus"
              : `Alle ${describeAutoRefreshInterval(value)}`}
          </option>
        ))}
      </select>
      {isActive && pauseReason && (
        <span className="text-[10px] text-amber-600 dark:text-amber-400">{pauseReason}</span>
      )}
    </div>
  );
}
