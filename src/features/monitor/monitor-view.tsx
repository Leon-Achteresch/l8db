import {
  ActivityIcon,
  CpuIcon,
  GaugeIcon,
  HardDriveIcon,
  LayersIcon,
  ListChecksIcon,
  LockIcon,
  type LucideIcon,
  MonitorIcon,
  NetworkIcon,
  ScrollTextIcon,
  UsersIcon,
} from "lucide-react";
import { startTransition } from "react";
import { NewBadge } from "@/components/new-badge";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LiveConnectionsTab } from "@/features/monitor/live-monitor/live-connections-tab";
import { LiveIoTab } from "@/features/monitor/live-monitor/live-io-tab";
import { LiveLocksTab } from "@/features/monitor/live-monitor/live-locks-tab";
import { LiveMonitorFooter } from "@/features/monitor/live-monitor/live-monitor-footer";
import { LiveMonitorToolbar } from "@/features/monitor/live-monitor/live-monitor-toolbar";
import { LiveOverviewTab } from "@/features/monitor/live-monitor/live-overview-tab";
import { LiveReplicationTab } from "@/features/monitor/live-monitor/live-replication-tab";
import { LiveResourcesTab } from "@/features/monitor/live-monitor/live-resources-tab";
import { LiveSessionsTab } from "@/features/monitor/live-monitor/live-sessions-tab";
import { useLiveMonitor } from "@/features/monitor/live-monitor/use-live-monitor";
import { LogsTab } from "@/features/monitor/monitor-view/logs-tab";
import { PerformanceTab } from "@/features/monitor/monitor-view/performance-tab";
import type { MonitorTab } from "@/features/monitor/monitor-view/types";
import { useMonitorView } from "@/features/monitor/monitor-view/use-monitor-view";
import { WorkloadTab } from "@/features/monitor/monitor-view/workload-tab";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";

const PRIMARY_TABS: { value: MonitorTab; label: string; icon: LucideIcon }[] = [
  { value: "live", label: "Live-Monitor", icon: MonitorIcon },
  { value: "sessions", label: "Sessions", icon: UsersIcon },
  { value: "connections", label: "Verbindungen", icon: NetworkIcon },
  { value: "resources", label: "Ressourcen", icon: CpuIcon },
  { value: "locks", label: "Locks", icon: LockIcon },
  { value: "io", label: "I/O", icon: HardDriveIcon },
  { value: "replication", label: "Replikation", icon: LayersIcon },
  { value: "logs", label: "Logs", icon: ScrollTextIcon },
];

const SECONDARY_TABS: { value: MonitorTab; label: string; icon: LucideIcon }[] = [
  { value: "performance", label: "Query-Verlauf", icon: GaugeIcon },
  { value: "workload", label: "Workload", icon: ListChecksIcon },
];

export function MonitorView() {
  const m = useMonitorView();
  const live = useLiveMonitor();
  const { ref: liveTabRef, isNew: liveTabIsNew } =
    useNewFeatureVisibility<HTMLButtonElement>("monitor.live");
  const { connection, tab, setTab, scopedServerOutput } = m;

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

  const changeTab = (value: MonitorTab) => startTransition(() => setTab(value));
  const secondary = SECONDARY_TABS.find((entry) => entry.value === tab);
  const tabLabel =
    [...PRIMARY_TABS, ...SECONDARY_TABS].find((entry) => entry.value === tab)?.label ?? "Monitor";

  return (
    <main className="workspace-canvas flex flex-1 flex-col overflow-auto" data-tour="monitor">
      <Tabs
        value={tab}
        onValueChange={(value) => changeTab(value as MonitorTab)}
        className="flex-1 gap-0"
      >
        <div className="sticky top-0 z-20 border-b bg-background/90 backdrop-blur">
          <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-3 px-6 py-2 lg:px-9">
            <TabsList variant="line" className="h-10 flex-wrap" aria-label="Monitor-Bereiche">
              {PRIMARY_TABS.map(({ value, label, icon: Icon }) => (
                <TabsTrigger
                  key={value}
                  value={value}
                  ref={value === "live" ? liveTabRef : undefined}
                  className="gap-1.5 text-xs"
                >
                  <Icon className="size-3.5" />
                  {label}
                  {value === "live" && liveTabIsNew ? <NewBadge /> : null}
                  {value === "locks" && live.waitingLocks > 0 && (
                    <Badge variant="destructive" className="h-4 px-1 text-[10px]">
                      {live.waitingLocks}
                    </Badge>
                  )}
                  {value === "logs" && scopedServerOutput.length > 0 && (
                    <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                      {scopedServerOutput.length}
                    </Badge>
                  )}
                </TabsTrigger>
              ))}
              {secondary && (
                <TabsTrigger value={secondary.value} className="gap-1.5 text-xs">
                  <secondary.icon className="size-3.5" />
                  {secondary.label}
                </TabsTrigger>
              )}
            </TabsList>
            <LiveMonitorToolbar
              m={live}
              onOpenHistory={() => changeTab("performance")}
              onOpenWorkload={() => changeTab("workload")}
            />
          </div>
        </div>

        <div className="mx-auto w-full max-w-[1600px] flex-1 px-6 pb-6 lg:px-9">
          {!live.live && tab !== "performance" && tab !== "workload" && tab !== "logs" && (
            <p className="mt-4 flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              <ActivityIcon className="size-3.5" />
              Live-Kennzahlen (TPS, CPU, I/O, Replikation) sind für diese Datenbank nicht verfügbar.
              Sessions und Locks werden angezeigt, soweit unterstützt.
            </p>
          )}
          <LiveOverviewTab m={live} />
          <LiveSessionsTab m={live} />
          <LiveConnectionsTab m={live} />
          <LiveResourcesTab m={live} />
          <LiveLocksTab
            m={live}
            onOpenSession={(pid) => {
              live.selectSession(pid);
              changeTab("sessions");
            }}
          />
          <LiveIoTab m={live} />
          <LiveReplicationTab m={live} />
          <LogsTab m={m} connection={connection} />
          <PerformanceTab m={m} />
          <WorkloadTab m={m} />
        </div>
      </Tabs>
      <LiveMonitorFooter m={live} connectionName={connection.name} tabLabel={tabLabel} />
    </main>
  );
}
