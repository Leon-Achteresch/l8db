import { Link } from "@tanstack/react-router";
import { AlertTriangleIcon, DatabaseIcon, GaugeIcon } from "lucide-react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { TabsContent } from "@/components/ui/tabs";
import {
  firstLine,
  formatBytes,
  formatDateTime,
  formatMs,
} from "@/features/monitor/monitor-view/format";
import { PerformanceStats } from "@/features/monitor/monitor-view/performance-stats";
import type { HistoryRange } from "@/features/monitor/monitor-view/types";
import type { MonitorViewState } from "@/features/monitor/monitor-view/use-monitor-view";
export function PerformanceTab({ m }: { m: MonitorViewState }) {
  const { capabilities, overviewQuery, range, setRange, latencyData, slowQueries } = m;
  return (
    <TabsContent value="performance" className="mt-5 space-y-5">
      <PerformanceStats m={m} />

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(300px,0.8fr)]">
        <Card size="sm">
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2 text-sm">
              <GaugeIcon className="size-4 text-primary" />
              Query-Latenz
            </CardTitle>
            <CardDescription>
              Die letzten gemessenen Queries aus dem lokalen Verlauf.
            </CardDescription>
            <CardAction>
              <Select value={range} onValueChange={(value) => setRange(value as HistoryRange)}>
                <SelectTrigger size="sm" className="h-7 w-40 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="24h">Letzte 24 Stunden</SelectItem>
                  <SelectItem value="7d">Letzte 7 Tage</SelectItem>
                  <SelectItem value="all">Gesamter Verlauf</SelectItem>
                </SelectContent>
              </Select>
            </CardAction>
          </CardHeader>
          <CardContent className="pt-5">
            {latencyData.length === 0 ? (
              <div className="grid h-64 place-items-center rounded-xl border border-dashed text-center text-xs text-muted-foreground">
                Noch keine Laufzeitdaten vorhanden.
              </div>
            ) : (
              <ChartContainer
                config={{ duration: { label: "Laufzeit", color: "var(--primary)" } }}
                className="h-64 w-full"
              >
                <AreaChart data={latencyData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                  <defs>
                    <linearGradient id="monitor-duration" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--color-duration)" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="var(--color-duration)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
                  <YAxis
                    width={48}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value) => `${value} ms`}
                  />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Area
                    type="monotone"
                    dataKey="duration"
                    stroke="var(--color-duration)"
                    fill="url(#monitor-duration)"
                    strokeWidth={2}
                    dot={false}
                  />
                </AreaChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2 text-sm">
              <DatabaseIcon className="size-4 text-primary" />
              Speicher nach Schema
            </CardTitle>
            <CardDescription>Größe der Tabellen und Materialized Views.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-5">
            {!capabilities.overview ? (
              <p className="text-xs text-muted-foreground">
                Diese Datenbank stellt keine Größenübersicht bereit.
              </p>
            ) : overviewQuery.isPending ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Spinner />
                Größen werden geladen…
              </div>
            ) : overviewQuery.isError ? (
              <p className="text-xs text-destructive">{String(overviewQuery.error)}</p>
            ) : overviewQuery.data?.schemas.length ? (
              overviewQuery.data.schemas.map((schema) => {
                const largest = Math.max(
                  1,
                  ...overviewQuery.data.schemas.map((item) => item.size_bytes),
                );
                return (
                  <div key={schema.schema} className="space-y-1.5">
                    <div className="flex items-center justify-between gap-3 text-xs">
                      <span className="truncate font-mono">{schema.schema}</span>
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        {formatBytes(schema.size_bytes)} · {schema.table_count} Tabellen
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary/65"
                        style={{
                          width: `${Math.max(1, (schema.size_bytes / largest) * 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                );
              })
            ) : (
              <p className="text-xs text-muted-foreground">Keine Schema-Daten vorhanden.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card size="sm">
        <CardHeader className="border-b">
          <CardTitle className="flex items-center gap-2 text-sm">
            <AlertTriangleIcon className="size-4 text-primary" />
            Langsamste Queries
          </CardTitle>
          <CardDescription>
            Grundlage sind die lokal gemessenen Ausführungszeiten des SQL-Arbeitsplatzes.
          </CardDescription>
          <CardAction>
            <Link to="/query" className="text-xs text-primary hover:underline">
              SQL-Arbeitsplatz öffnen
            </Link>
          </CardAction>
        </CardHeader>
        <CardContent className="p-0">
          slowQueries.length === 0 ? (
          <p className="px-6 py-8 text-center text-xs text-muted-foreground">
            Keine gemessenen Queries im gewählten Zeitraum.
          </p>
          ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="border-b bg-muted/30 text-left text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Zeit</th>
                  <th className="px-4 py-2 font-medium">Query</th>
                  <th className="px-4 py-2 text-right font-medium">Laufzeit</th>
                  <th className="px-4 py-2 text-right font-medium">Zeilen</th>
                  <th className="px-4 py-2 text-right font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {slowQueries.map((entry) => (
                  <tr key={entry.id} className="hover:bg-muted/30">
                    <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">
                      {formatDateTime(entry.ranAt)}
                    </td>
                    <td className="max-w-[720px] truncate px-4 py-2.5 font-mono" title={entry.sql}>
                      {firstLine(entry.sql)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right font-mono tabular-nums">
                      {formatMs(entry.durationMs)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                      {entry.rowCount == null ? "—" : entry.rowCount.toLocaleString("de-DE")}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Badge
                        variant={entry.error ? "destructive" : "secondary"}
                        className="px-1.5 py-0 text-[10px]"
                      >
                        {entry.error ? "Fehler" : "OK"}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )
        </CardContent>
      </Card>
    </TabsContent>
  );
}
