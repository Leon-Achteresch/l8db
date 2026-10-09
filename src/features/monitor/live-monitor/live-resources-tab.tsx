import { CpuIcon, FlameIcon, HardDriveIcon, Undo2Icon } from "lucide-react";
import { TabsContent } from "@/components/ui/tabs";
import {
  formatBytes,
  formatCount,
  formatPercent,
  formatSeconds,
} from "@/features/monitor/monitor-view/format";
import { LiveActivityCard } from "./live-activity-card";
import { LiveInfoCard } from "./live-info-card";
import { LiveStatTile } from "./live-stat-tile";
import type { LiveMonitorState } from "./use-live-monitor";

export function LiveResourcesTab({ m }: { m: LiveMonitorState }) {
  const { metrics, latest } = m;
  const cpu = latest?.cpu ?? null;
  const hitRatio =
    metrics && metrics.blocks_hit + metrics.blocks_read > 0
      ? (metrics.blocks_hit / (metrics.blocks_hit + metrics.blocks_read)) * 100
      : null;
  const rollbackRatio =
    metrics && metrics.commits + metrics.rollbacks > 0
      ? (metrics.rollbacks / (metrics.commits + metrics.rollbacks)) * 100
      : null;
  return (
    <TabsContent value="resources" className="mt-4 space-y-4">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <LiveStatTile
          label="CPU Auslastung"
          icon={CpuIcon}
          value={formatPercent(cpu)}
          progress={cpu}
          hint={
            cpu == null
              ? "Benötigt Leserechte auf /proc/stat (pg_read_server_files) auf einem Linux-Server."
              : undefined
          }
        />
        <LiveStatTile
          label="Cache-Trefferquote"
          icon={HardDriveIcon}
          value={formatPercent(hitRatio, 1)}
          progress={hitRatio}
          tone={hitRatio != null && hitRatio < 90 ? "warning" : "default"}
        />
        <LiveStatTile
          label="Rollback-Anteil"
          icon={Undo2Icon}
          value={formatPercent(rollbackRatio, 1)}
          progress={rollbackRatio}
          tone={rollbackRatio != null && rollbackRatio > 5 ? "warning" : "default"}
        />
        <LiveStatTile
          label="Temporäre Dateien"
          icon={FlameIcon}
          value={latest?.tempBytes == null ? "—" : `${formatBytes(latest.tempBytes)}/s`}
          suffix={metrics?.temp_bytes == null ? null : `gesamt ${formatBytes(metrics.temp_bytes)}`}
        />
      </div>
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,400px)]">
        <LiveActivityCard m={m} title="Ressourcenverlauf" metrics={["cpu", "connections"]} />
        <LiveInfoCard
          title="Server"
          rows={[
            ["Version", metrics?.server_version || "—"],
            ["Laufzeit", formatSeconds(metrics?.uptime_seconds ?? null)],
            ["Zeitzone", metrics?.timezone ?? "—"],
            ["Isolationslevel", metrics?.default_isolation ?? "—"],
            ["Rolle", metrics ? (metrics.in_recovery ? "Standby / Replikat" : "Primär") : "—"],
            ["Max. Verbindungen", formatCount(metrics?.max_connections ?? null)],
            ["Deadlocks (gesamt)", formatCount(metrics?.deadlocks ?? null)],
          ]}
        />
      </div>
    </TabsContent>
  );
}
