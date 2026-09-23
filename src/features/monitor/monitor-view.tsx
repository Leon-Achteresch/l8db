import { ActivityIcon, GaugeIcon, ListChecksIcon, RefreshCw, TerminalIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ActivityTab } from "@/features/monitor/monitor-view/activity-tab";
import { formatTime } from "@/features/monitor/monitor-view/format";
import { LogsTab } from "@/features/monitor/monitor-view/logs-tab";
import { PerformanceTab } from "@/features/monitor/monitor-view/performance-tab";
import type { MonitorTab } from "@/features/monitor/monitor-view/types";
import { useMonitorView } from "@/features/monitor/monitor-view/use-monitor-view";
import { WorkloadTab } from "@/features/monitor/monitor-view/workload-tab";
import { providerFor } from "@/lib/connection-url";

export function MonitorView() {
  const m = useMonitorView();
  const {
    connection,
    database,
    refresh,
    isRefreshing,
    tab,
    setTab,
    scopedServerOutput,
    blockedSessions,
    lastUpdatedAt,
  } = m;

  if (!connection) {
    return (
      <main className="flex flex-1 items-center justify-center p-8">
        <div className="text-center">
          <GaugeIcon className="mx-auto size-8 text-muted-foreground/50" />
          <h1 className="mt-3 text-lg font-semibold">Monitor</h1>
          <p className="mt-1 text-sm text-muted-foreground">Keine Verbindung aktiv.</p>
        </div>
      </main>
    );
  }

  const provider = providerFor(connection);

  return (
    <main className="workspace-canvas flex-1 overflow-auto" data-tour="monitor">
      <div className="mx-auto max-w-[1500px] px-6 py-8 lg:px-9">
        <header className="mb-7 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-3 flex items-center gap-2">
              <span className="eyebrow">Betrieb</span>
              <span className="text-muted-foreground/40">/</span>
              <span className="text-[11px] text-muted-foreground">{provider.name}</span>
            </div>
            <h1 className="text-3xl font-semibold tracking-[-0.045em]">Monitor</h1>
            <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="font-mono">{database ?? "Aktive Verbindung"}</span>
              <span className="size-1 rounded-full bg-border" />
              <span>Live-Aktivität alle 5 s</span>
              {lastUpdatedAt > 0 && (
                <>
                  <span className="size-1 rounded-full bg-border" />
                  <span>Stand {formatTime(lastUpdatedAt)}</span>
                </>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={blockedSessions ? "destructive" : "secondary"} className="gap-1.5">
              <ActivityIcon className="size-3" />
              {blockedSessions ? `${blockedSessions} blockiert` : "System stabil"}
            </Badge>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void refresh()}
              disabled={isRefreshing}
              aria-label="Monitor aktualisieren"
            >
              <RefreshCw className={isRefreshing ? "size-3.5 animate-spin" : "size-3.5"} />
              Aktualisieren
            </Button>
          </div>
        </header>

        <Tabs value={tab} onValueChange={(value) => setTab(value as MonitorTab)}>
          <TabsList>
            <TabsTrigger value="performance" className="gap-1.5 text-xs">
              <GaugeIcon className="size-3.5" />
              Performance
            </TabsTrigger>
            <TabsTrigger value="workload" className="gap-1.5 text-xs">
              <ListChecksIcon className="size-3.5" />
              Workload
            </TabsTrigger>
            <TabsTrigger value="logs" className="gap-1.5 text-xs">
              <TerminalIcon className="size-3.5" />
              Logs
              {scopedServerOutput.length > 0 && (
                <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                  {scopedServerOutput.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="activity" className="gap-1.5 text-xs">
              <ActivityIcon className="size-3.5" />
              Aktivität
            </TabsTrigger>
          </TabsList>

          <PerformanceTab m={m} />
          <WorkloadTab m={m} />
          <LogsTab m={m} connection={connection} />
          <ActivityTab m={m} />
        </Tabs>
      </div>
    </main>
  );
}
