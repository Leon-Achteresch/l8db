import {
  ActivityIcon,
  AlertTriangleIcon,
  DatabaseIcon,
  GaugeIcon,
  SquareTerminal,
} from "lucide-react";
import { firstLine, formatBytes, formatMs } from "@/features/monitor/monitor-view/format";
import type { MonitorViewState } from "@/features/monitor/monitor-view/use-monitor-view";

export function PerformanceStats({ m }: { m: MonitorViewState }) {
  const { capabilities, overviewQuery, range, measuredHistory, stats, activeSessions } = m;
  const rangeLabel =
    range === "24h" ? "Letzte 24 Stunden" : range === "7d" ? "Letzte 7 Tage" : "Gesamter Verlauf";
  return (
    <div className="grid grid-cols-2 divide-x divide-border/70 overflow-hidden rounded-2xl border bg-card md:grid-cols-3 xl:grid-cols-6">
      {[
        {
          label: "Queries",
          value: stats.total.toLocaleString("de-DE"),
          detail: rangeLabel,
          icon: SquareTerminal,
        },
        {
          label: "Ø Laufzeit",
          value: formatMs(stats.average),
          detail: `${measuredHistory.length} gemessen`,
          icon: GaugeIcon,
        },
        {
          label: "Langsamste",
          value: formatMs(stats.slowest?.durationMs ?? null),
          detail: stats.slowest ? firstLine(stats.slowest.sql) : "Keine Messung",
          icon: AlertTriangleIcon,
        },
        {
          label: "Fehler",
          value: stats.errors.toLocaleString("de-DE"),
          detail: stats.total
            ? `${Math.round((stats.errors / stats.total) * 100)} % Anteil`
            : "Keine Queries",
          icon: AlertTriangleIcon,
        },
        {
          label: "Aktive Sessions",
          value: capabilities.sessions
            ? activeSessions == null
              ? "…"
              : activeSessions.toLocaleString("de-DE")
            : "—",
          detail: capabilities.sessions ? "Live" : "Nicht verfügbar",
          icon: ActivityIcon,
        },
        {
          label: "Datenbankgröße",
          value: capabilities.overview
            ? overviewQuery.isPending
              ? "…"
              : overviewQuery.data
                ? formatBytes(overviewQuery.data.size_bytes)
                : "—"
            : "—",
          detail: capabilities.overview ? "Gesamt" : "Nicht verfügbar",
          icon: DatabaseIcon,
        },
      ].map(({ label, value, detail, icon: Icon }) => (
        <div key={label} className="min-w-0 px-5 py-5">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Icon className="size-3.5 text-primary" />
            {label}
          </div>
          <p className="mt-2 truncate text-2xl font-medium tracking-tight" title={detail}>
            {value}
          </p>
          <p className="mt-1 truncate text-[10px] text-muted-foreground" title={detail}>
            {detail}
          </p>
        </div>
      ))}
    </div>
  );
}
