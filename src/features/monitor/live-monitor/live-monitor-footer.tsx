import { ChevronRightIcon, RefreshCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/features/monitor/monitor-view/format";
import { cn } from "@/lib/utils";
import type { LiveMonitorState } from "./use-live-monitor";

export function LiveMonitorFooter({
  m,
  connectionName,
  tabLabel,
}: {
  m: LiveMonitorState;
  connectionName: string;
  tabLabel: string;
}) {
  const fetching = m.sessionsQuery.isFetching;
  return (
    <footer className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 border-t bg-background/90 px-6 py-2 text-xs text-muted-foreground backdrop-blur lg:px-9">
      <nav aria-label="Pfad" className="flex min-w-0 items-center gap-1.5">
        <span
          className={cn(
            "size-2 rounded-full",
            m.metricsError ? "bg-destructive" : m.paused ? "bg-amber-500" : "bg-emerald-500",
          )}
        />
        <span className="truncate">{connectionName}</span>
        <ChevronRightIcon className="size-3" />
        <span className="truncate">{m.database ?? "Standard"}</span>
        <ChevronRightIcon className="size-3" />
        <span className="truncate text-foreground">{tabLabel}</span>
      </nav>
      <div className="flex items-center gap-4">
        <span className="flex items-center gap-1">
          Letzte Aktualisierung: {m.lastUpdatedAt > 0 ? formatDateTime(m.lastUpdatedAt) : "—"}
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Jetzt aktualisieren"
            onClick={m.refresh}
          >
            <RefreshCwIcon className={fetching ? "animate-spin" : undefined} />
          </Button>
        </span>
        <span>
          Zeitzone: {m.metrics?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone}
        </span>
        {m.paused && <span className="text-amber-600 dark:text-amber-400">Pausiert</span>}
      </div>
    </footer>
  );
}
