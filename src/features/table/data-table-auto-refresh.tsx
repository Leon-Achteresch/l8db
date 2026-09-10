import { PauseIcon, RefreshCwIcon } from "lucide-react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
    <div className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
      {isActive && pauseReason ? (
        <PauseIcon className="size-3 text-amber-500" />
      ) : (
        <RefreshCwIcon className={cn("size-3", isActive ? "text-primary" : "opacity-60")} />
      )}
      <Select
        value={String(intervalMs)}
        onValueChange={(value) =>
          onIntervalChange(normalizeAutoRefreshInterval(Number(value)))
        }
      >
        <SelectTrigger
          size="sm"
          title={pauseReason ? `Pausiert: ${pauseReason}` : "Automatisch aktualisieren"}
          className="h-5 gap-1 border-border bg-background px-1 text-[11px] text-muted-foreground hover:bg-accent"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper">
          {AUTO_REFRESH_INTERVALS.map((value) => (
            <SelectItem key={value} value={String(value)} className="text-[11px]">
              {value === 0
                ? "Auto-Aktualisierung: aus"
                : `Alle ${describeAutoRefreshInterval(value)}`}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {isActive && pauseReason && (
        <span className="text-[10px] text-amber-600 dark:text-amber-400">{pauseReason}</span>
      )}
    </div>
  );
}
