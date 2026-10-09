import {
  ActivityIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  CpuIcon,
  DatabaseIcon,
  LockIcon,
  NetworkIcon,
  UserIcon,
} from "lucide-react";
import { formatBytes, formatCount, formatPercent } from "@/features/monitor/monitor-view/format";
import { LiveStatTile } from "./live-stat-tile";
import type { LiveMonitorState } from "./use-live-monitor";

function Change({ value }: { value: number | null }) {
  if (value == null || !Number.isFinite(value)) return null;
  const up = value >= 0;
  const Icon = up ? ArrowUpIcon : ArrowDownIcon;
  return (
    <span
      className={
        up
          ? "flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400"
          : "flex items-center gap-0.5 text-amber-600 dark:text-amber-400"
      }
    >
      <Icon className="size-3" />
      {`${up ? "+" : ""}${value.toLocaleString("de-DE", { maximumFractionDigits: 1 })} %`}
    </span>
  );
}

export function LiveKpiTiles({ m }: { m: LiveMonitorState }) {
  const { metrics, latest, sessions, connections, activeSessions, waitingLocks, locks } = m;
  const maxConnections = metrics?.max_connections ?? null;
  const cpu = latest?.cpu ?? null;
  const lockBase = Math.max(1, locks.length, waitingLocks);
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <LiveStatTile
        label="Aktive Sessions"
        icon={UserIcon}
        value={formatCount(activeSessions)}
        suffix={`von ${formatCount(sessions.length)}`}
        progress={sessions.length ? (activeSessions / sessions.length) * 100 : 0}
      />
      <LiveStatTile
        label="Throughput (TPS)"
        icon={ActivityIcon}
        value={m.live ? formatCount(latest?.tps ?? null, latest && latest.tps < 10 ? 1 : 0) : "—"}
        suffix={<Change value={m.tpsChange} />}
        hint="Transaktionen pro Sekunde, verglichen mit dem Durchschnitt im gewählten Zeitraum."
      />
      <LiveStatTile
        label="CPU Auslastung"
        icon={CpuIcon}
        value={formatPercent(cpu)}
        progress={cpu}
        tone={
          cpu != null && cpu >= 90 ? "danger" : cpu != null && cpu >= 70 ? "warning" : "default"
        }
        hint={
          cpu == null
            ? "Die CPU-Last des Servers ist nur mit Leserechten auf /proc/stat (pg_read_server_files) auf Linux-Servern verfügbar."
            : "CPU-Last des Datenbankservers"
        }
      />
      <LiveStatTile
        label="Wartende Locks"
        icon={LockIcon}
        value={formatCount(waitingLocks)}
        progress={(waitingLocks / lockBase) * 100}
        tone={waitingLocks > 0 ? "warning" : "default"}
      />
      <LiveStatTile
        label="Datenbankgröße"
        icon={DatabaseIcon}
        value={m.sizeBytes == null ? "—" : formatBytes(m.sizeBytes)}
        suffix={
          m.sizeChange == null
            ? null
            : `${m.sizeChange >= 0 ? "+" : ""}${m.sizeChange.toLocaleString("de-DE", { maximumFractionDigits: 1 })} %`
        }
      />
      <LiveStatTile
        label="Verbindungen"
        icon={NetworkIcon}
        value={formatCount(connections)}
        suffix={maxConnections ? `von ${formatCount(maxConnections)}` : null}
        progress={maxConnections ? (connections / maxConnections) * 100 : null}
        tone={
          maxConnections && connections / maxConnections >= 0.9
            ? "danger"
            : maxConnections && connections / maxConnections >= 0.75
              ? "warning"
              : "default"
        }
      />
    </div>
  );
}
