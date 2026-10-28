import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  supabaseStudioObservabilityHealth,
  supabaseStudioObservabilitySizes,
} from "@/lib/db/supabase-studio-observability";
import { formatBytes } from "../storage/storage-format";
import {
  formatMs,
  formatNumber,
  formatPercent,
  type LogsTabProps,
  logsQueryKey,
} from "./logs-format";
import { LogsListBlock } from "./logs-list-block";
import { LogsQueryState } from "./logs-query-state";

const THRESHOLDS = [
  { seconds: 60, label: "länger als 1 min" },
  { seconds: 300, label: "länger als 5 min" },
  { seconds: 3600, label: "länger als 1 h" },
];

export function LogsHealthTab({ reference, refetchInterval }: LogsTabProps) {
  const [threshold, setThreshold] = useState(60);
  const health = useQuery({
    queryKey: logsQueryKey(reference, "health", threshold),
    queryFn: () => supabaseStudioObservabilityHealth(reference, threshold),
    refetchInterval,
  });
  const sizes = useQuery({
    queryKey: logsQueryKey(reference, "health", "sizes"),
    queryFn: () => supabaseStudioObservabilitySizes(reference),
    refetchInterval,
  });
  return (
    <div className="space-y-6">
      <LogsQueryState query={health}>
        {(data) => {
          const used = data.connections.rows.reduce((sum, row) => sum + row.count, 0);
          return (
            <div className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  ["Datenbankgröße", formatBytes(data.database_size) || "–"],
                  ["Verbindungen", `${used} / ${data.max_connections ?? "–"}`],
                  ["Cache-Trefferquote Tabellen", formatPercent(data.table_hit_ratio)],
                  ["Cache-Trefferquote Indizes", formatPercent(data.index_hit_ratio)],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-xl border p-3">
                    <div className="text-xs text-muted-foreground">{label}</div>
                    <div className="text-lg font-semibold tabular-nums">{value}</div>
                  </div>
                ))}
              </div>
              <LogsListBlock
                title="Verbindungen nach Rolle und Status"
                headers={["Rolle", "Status", "Anzahl"]}
                rows={data.connections.rows}
                hasMore={data.connections.has_more}
                empty="Keine Verbindungen."
              >
                {(row) => (
                  <tr key={`${row.role}-${row.state}`}>
                    <td>{row.role}</td>
                    <td>{row.state}</td>
                    <td className="tabular-nums">{row.count}</td>
                  </tr>
                )}
              </LogsListBlock>
              <section className="space-y-2">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-medium">Lang laufende Transaktionen</h3>
                  <Select
                    value={String(threshold)}
                    onValueChange={(value) => setThreshold(Number(value))}
                  >
                    <SelectTrigger size="sm" className="h-7 w-40 text-xs" aria-label="Schwelle">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {THRESHOLDS.map((item) => (
                        <SelectItem
                          key={item.seconds}
                          value={String(item.seconds)}
                          className="text-xs"
                        >
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <LogsListBlock
                  headers={["PID", "Rolle", "Status", "Dauer", "Abfrage"]}
                  rows={data.long_transactions.rows}
                  hasMore={data.long_transactions.has_more}
                  empty="Keine lang laufenden Transaktionen."
                >
                  {(row) => (
                    <tr key={row.pid}>
                      <td className="tabular-nums">{row.pid}</td>
                      <td>{row.usename ?? "–"}</td>
                      <td>{row.state ?? "–"}</td>
                      <td className="whitespace-nowrap tabular-nums">{formatMs(row.xact_ms)}</td>
                      <td className="max-w-md">
                        <code className="line-clamp-2 font-mono break-all">{row.query}</code>
                      </td>
                    </tr>
                  )}
                </LogsListBlock>
              </section>
              <LogsListBlock
                title="Replikations-Slots"
                headers={["Name", "Typ", "Plugin", "Datenbank", "Aktiv", "Zurückgehaltenes WAL"]}
                rows={data.replication_slots.rows}
                hasMore={data.replication_slots.has_more}
                empty="Keine Replikations-Slots."
              >
                {(row) => (
                  <tr key={row.slot_name}>
                    <td className="font-mono">{row.slot_name}</td>
                    <td>{row.slot_type}</td>
                    <td>{row.plugin ?? "–"}</td>
                    <td>{row.database ?? "–"}</td>
                    <td className={row.active ? "" : "text-amber-600 dark:text-amber-400"}>
                      {row.active ? `ja (${row.active_pid})` : "nein"}
                    </td>
                    <td className="tabular-nums">{row.retained_wal ?? "–"}</td>
                  </tr>
                )}
              </LogsListBlock>
            </div>
          );
        }}
      </LogsQueryState>
      <LogsQueryState query={sizes}>
        {(data) => (
          <div className="space-y-5">
            <LogsListBlock
              title="Tabellengrößen"
              headers={["Tabelle", "Zeilen (geschätzt)", "Gesamt", "Daten", "Indizes"]}
              rows={data.tables.rows}
              hasMore={data.tables.has_more}
              empty="Keine Tabellen."
            >
              {(row) => (
                <tr key={`${row.schema}.${row.name}`}>
                  <td className="font-mono">
                    {row.schema}.{row.name}
                  </td>
                  <td className="tabular-nums">{formatNumber(Math.max(row.estimated_rows, 0))}</td>
                  <td className="tabular-nums">{formatBytes(row.total_bytes)}</td>
                  <td className="tabular-nums">{formatBytes(row.table_bytes)}</td>
                  <td className="tabular-nums">{formatBytes(row.index_bytes)}</td>
                </tr>
              )}
            </LogsListBlock>
            <LogsListBlock
              title="Indexgrößen"
              headers={["Index", "Tabelle", "Größe", "Scans"]}
              rows={data.indexes.rows}
              hasMore={data.indexes.has_more}
              empty="Keine Indizes."
            >
              {(row) => (
                <tr key={`${row.schema}.${row.name}`}>
                  <td className="font-mono">{row.name}</td>
                  <td className="font-mono">
                    {row.schema}.{row.table}
                  </td>
                  <td className="tabular-nums">{formatBytes(row.bytes)}</td>
                  <td className="tabular-nums">{formatNumber(row.scans)}</td>
                </tr>
              )}
            </LogsListBlock>
            <LogsListBlock
              title="Ungenutzte Indizes"
              headers={["Index", "Tabelle", "Größe", "Definition"]}
              rows={data.unused_indexes.rows}
              hasMore={data.unused_indexes.has_more}
              empty="Keine ungenutzten Indizes."
            >
              {(row) => (
                <tr key={`${row.schema}.${row.name}`}>
                  <td className="font-mono">{row.name}</td>
                  <td className="font-mono">
                    {row.schema}.{row.table}
                  </td>
                  <td className="tabular-nums">{formatBytes(row.bytes)}</td>
                  <td className="max-w-md">
                    <code className="line-clamp-2 font-mono break-all">{row.definition}</code>
                  </td>
                </tr>
              )}
            </LogsListBlock>
          </div>
        )}
      </LogsQueryState>
    </div>
  );
}
