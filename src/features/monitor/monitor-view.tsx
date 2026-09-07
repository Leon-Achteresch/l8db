import { Link } from "@tanstack/react-router";
import {
  ActivityIcon,
  AlertTriangleIcon,
  DatabaseIcon,
  GaugeIcon,
  LockKeyhole,
  RefreshCw,
  SearchIcon,
  SquareTerminal,
  TerminalIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { providerFor } from "@/lib/connection-url";
import { useActiveConnection } from "@/lib/connections";
import type { SessionInfo } from "@/lib/db";
import { useActiveCapabilities, useActiveDatabase } from "@/lib/db-selection";
import {
  useDatabaseOverviewQuery,
  useLocksQuery,
  useRefreshConnection,
  useSessionsQuery,
} from "@/lib/queries";
import { type QueryHistoryEntry, useQueryHistoryStore } from "@/lib/query-history";
import {
  collectServerOutput,
  type ServerOutputEntry,
  toggleServerOutput as toggleServerOutputOnConnection,
  useServerOutputStore,
} from "@/lib/server-output";
import { effectiveConnectionString } from "@/lib/ssh";

type MonitorTab = "performance" | "logs" | "activity";
type HistoryRange = "all" | "24h" | "7d";
type HistoryFilter = "all" | "success" | "error";
const EMPTY_SERVER_OUTPUT: ServerOutputEntry[] = [];

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toLocaleString("de-DE", { maximumFractionDigits: 1 })} ${units[index]}`;
}

function formatMs(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toLocaleString("de-DE", { maximumFractionDigits: 0 })} ms`;
}

function formatTime(value: number | string | null): string {
  if (value == null) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatDateTime(value: number | string | null): string {
  if (value == null) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("de-DE", {
    dateStyle: "short",
    timeStyle: "medium",
  });
}

function formatElapsed(value: string | null): string {
  if (!value) return "—";
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "—";
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

function firstLine(sql: string): string {
  const line =
    sql
      .split("\n")
      .map((part) => part.trim())
      .filter(Boolean)[0] ?? "";
  return line.length > 110 ? `${line.slice(0, 110)}…` : line;
}

function levelVariant(level: string): "destructive" | "secondary" | "outline" {
  const upper = level.toUpperCase();
  if (upper.includes("ERROR") || upper.includes("FEHLER")) return "destructive";
  if (upper.includes("WARN")) return "secondary";
  return "outline";
}

function sessionPriority(session: SessionInfo): number {
  if (session.blocked_by.length > 0) return 0;
  if (session.state === "active") return 1;
  if (session.wait_event) return 2;
  return 3;
}

function sessionStateVariant(
  session: SessionInfo,
): "default" | "secondary" | "destructive" | "outline" {
  if (session.blocked_by.length > 0) return "destructive";
  if (session.state === "active") return "default";
  if (session.wait_event) return "secondary";
  return "outline";
}

export function MonitorView() {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const capabilities = useActiveCapabilities();
  const { refresh, isRefreshing } = useRefreshConnection();
  const sessionsQuery = useSessionsQuery(5000);
  const locksQuery = useLocksQuery(5000);
  const overviewQuery = useDatabaseOverviewQuery(30_000);
  const historyEntries = useQueryHistoryStore((state) => state.entries);
  const clearHistory = useQueryHistoryStore((state) => state.clearForConnection);
  const serverOutputEnabled = useServerOutputStore((state) =>
    connection ? state.enabled[connection.id] === true : false,
  );
  const serverOutputEntries = useServerOutputStore((state) =>
    connection ? (state.entries[connection.id] ?? EMPTY_SERVER_OUTPUT) : EMPTY_SERVER_OUTPUT,
  );
  const clearServerOutput = useServerOutputStore((state) => state.clear);
  const [tab, setTab] = useState<MonitorTab>("performance");
  const [range, setRange] = useState<HistoryRange>("7d");
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>("all");
  const [historySearch, setHistorySearch] = useState("");
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null);
  const [serverOutputBusy, setServerOutputBusy] = useState(false);

  useEffect(() => {
    if (!connection || !capabilities.server_output || !serverOutputEnabled) return;
    const collect = () => {
      if (document.hidden) return;
      void collectServerOutput(
        connection.kind,
        effectiveConnectionString(connection),
        connection.id,
        database ?? undefined,
      ).catch(() => undefined);
    };
    collect();
    const timer = window.setInterval(collect, 2500);
    return () => window.clearInterval(timer);
  }, [capabilities.server_output, connection, database, serverOutputEnabled]);

  const scopedHistory = useMemo(() => {
    if (!connection) return [];
    const cutoff =
      range === "24h"
        ? Date.now() - 24 * 60 * 60 * 1000
        : range === "7d"
          ? Date.now() - 7 * 24 * 60 * 60 * 1000
          : 0;
    return historyEntries.filter(
      (entry) =>
        entry.connectionId === connection.id &&
        entry.database === database &&
        entry.ranAt >= cutoff,
    );
  }, [connection, database, historyEntries, range]);

  const measuredHistory = useMemo(
    () =>
      scopedHistory.filter(
        (entry): entry is QueryHistoryEntry & { durationMs: number } =>
          typeof entry.durationMs === "number" && Number.isFinite(entry.durationMs),
      ),
    [scopedHistory],
  );

  const stats = useMemo(() => {
    const totalDuration = measuredHistory.reduce((sum, entry) => sum + entry.durationMs, 0);
    const slowest = measuredHistory.reduce<(QueryHistoryEntry & { durationMs: number }) | null>(
      (current, entry) => (!current || entry.durationMs > current.durationMs ? entry : current),
      null,
    );
    return {
      total: scopedHistory.length,
      errors: scopedHistory.filter((entry) => Boolean(entry.error)).length,
      success: scopedHistory.filter((entry) => !entry.error).length,
      average: measuredHistory.length ? totalDuration / measuredHistory.length : null,
      slowest,
    };
  }, [measuredHistory, scopedHistory]);

  const latencyData = useMemo(
    () =>
      measuredHistory
        .slice(0, 30)
        .reverse()
        .map((entry) => ({
          label: formatTime(entry.ranAt),
          duration: entry.durationMs,
        })),
    [measuredHistory],
  );

  const slowQueries = useMemo(
    () =>
      [...measuredHistory].sort((left, right) => right.durationMs - left.durationMs).slice(0, 8),
    [measuredHistory],
  );

  const filteredHistory = useMemo(() => {
    const search = historySearch.trim().toLowerCase();
    return scopedHistory.filter((entry) => {
      const matchesFilter =
        historyFilter === "all" ||
        (historyFilter === "error" && Boolean(entry.error)) ||
        (historyFilter === "success" && !entry.error);
      return matchesFilter && (!search || entry.sql.toLowerCase().includes(search));
    });
  }, [historyFilter, historySearch, scopedHistory]);

  const scopedServerOutput = useMemo(
    () =>
      serverOutputEntries.filter(
        (entry) => !database || entry.database === database || entry.database === null,
      ),
    [database, serverOutputEntries],
  );

  const visibleSessions = useMemo(
    () =>
      [...(sessionsQuery.data ?? [])]
        .sort((left, right) => sessionPriority(left) - sessionPriority(right))
        .slice(0, 16),
    [sessionsQuery.data],
  );

  const activeSessions = sessionsQuery.data?.filter((session) => session.state === "active").length;
  const blockedSessions = sessionsQuery.data?.filter(
    (session) => session.blocked_by.length > 0,
  ).length;
  const lastUpdatedAt = Math.max(
    sessionsQuery.dataUpdatedAt ?? 0,
    locksQuery.dataUpdatedAt ?? 0,
    overviewQuery.dataUpdatedAt ?? 0,
  );

  const toggleServerOutput = async (enabled: boolean) => {
    if (!connection) return;
    setServerOutputBusy(true);
    try {
      await toggleServerOutputOnConnection(
        connection.kind,
        effectiveConnectionString(connection),
        connection.id,
        enabled,
        database ?? undefined,
      );
    } finally {
      setServerOutputBusy(false);
    }
  };

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
  const rangeLabel =
    range === "24h" ? "Letzte 24 Stunden" : range === "7d" ? "Letzte 7 Tage" : "Gesamter Verlauf";

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

          <TabsContent value="performance" className="mt-5 space-y-5">
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
                    <Select
                      value={range}
                      onValueChange={(value) => setRange(value as HistoryRange)}
                    >
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
                      <AreaChart
                        data={latencyData}
                        margin={{ top: 8, right: 8, left: 8, bottom: 0 }}
                      >
                        <defs>
                          <linearGradient id="monitor-duration" x1="0" y1="0" x2="0" y2="1">
                            <stop
                              offset="5%"
                              stopColor="var(--color-duration)"
                              stopOpacity={0.35}
                            />
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
                {slowQueries.length === 0 ? (
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
                            <td
                              className="max-w-[720px] truncate px-4 py-2.5 font-mono"
                              title={entry.sql}
                            >
                              {firstLine(entry.sql)}
                            </td>
                            <td className="whitespace-nowrap px-4 py-2.5 text-right font-mono tabular-nums">
                              {formatMs(entry.durationMs)}
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                              {entry.rowCount == null
                                ? "—"
                                : entry.rowCount.toLocaleString("de-DE")}
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
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="logs" className="mt-5 space-y-5">
            <div className="grid items-start gap-5 xl:grid-cols-[minmax(300px,0.8fr)_minmax(0,1.2fr)]">
              <Card size="sm">
                <CardHeader className="border-b">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <TerminalIcon className="size-4 text-primary" />
                    Server-Ausgabe
                  </CardTitle>
                  <CardDescription>
                    Notices und DBMS-Ausgabe, sofern der Provider sie unterstützt.
                  </CardDescription>
                  <CardAction className="flex items-center gap-2">
                    {capabilities.server_output ? (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Switch
                          checked={serverOutputEnabled}
                          disabled={serverOutputBusy}
                          onCheckedChange={(checked) => void toggleServerOutput(checked)}
                          aria-label="Server-Ausgabe aktivieren"
                        />
                        <span>Aktiv</span>
                      </div>
                    ) : (
                      <Badge variant="outline" className="text-[10px]">
                        Nicht verfügbar
                      </Badge>
                    )}
                  </CardAction>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="flex items-center justify-between border-b px-4 py-2 text-[10px] text-muted-foreground">
                    <span>{scopedServerOutput.length} Meldungen gespeichert</span>
                    <Button
                      variant="ghost"
                      size="xs"
                      className="h-6 px-2 text-[10px]"
                      disabled={scopedServerOutput.length === 0}
                      onClick={() => connection && clearServerOutput(connection.id)}
                    >
                      Leeren
                    </Button>
                  </div>
                  <div className="max-h-[520px] overflow-auto">
                    {scopedServerOutput.length === 0 ? (
                      <p className="px-5 py-8 text-center text-xs text-muted-foreground">
                        {capabilities.server_output
                          ? serverOutputEnabled
                            ? "Noch keine Server-Ausgabe eingetroffen."
                            : "Aktiviere die Ausgabe, um neue Meldungen zu sammeln."
                          : "Dieser Provider unterstützt keine Server-Ausgabe."}
                      </p>
                    ) : (
                      <ul className="divide-y divide-border/60">
                        {[...scopedServerOutput].reverse().map((entry: ServerOutputEntry) => (
                          <li key={entry.id} className="flex items-start gap-2 px-4 py-2.5 text-xs">
                            <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                              {formatTime(entry.at)}
                            </span>
                            <Badge
                              variant={levelVariant(entry.level)}
                              className="shrink-0 px-1.5 py-0 text-[10px]"
                            >
                              {entry.level}
                            </Badge>
                            <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">
                              {entry.message}
                              {entry.detail && (
                                <span className="mt-1 block text-muted-foreground">
                                  {entry.detail}
                                </span>
                              )}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card size="sm">
                <CardHeader className="border-b">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <SquareTerminal className="size-4 text-primary" />
                    Query-Log
                  </CardTitle>
                  <CardDescription>
                    Ausgeführte Queries dieser Verbindung aus dem lokalen Verlauf.
                  </CardDescription>
                  <CardAction>
                    <Button
                      variant="ghost"
                      size="xs"
                      className="h-7 px-2 text-[10px]"
                      disabled={scopedHistory.length === 0}
                      onClick={() => clearHistory(connection.id)}
                    >
                      Verlauf leeren
                    </Button>
                  </CardAction>
                </CardHeader>
                <div className="flex flex-wrap gap-2 border-b p-4">
                  <div className="relative min-w-48 flex-1">
                    <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={historySearch}
                      onChange={(event) => setHistorySearch(event.target.value)}
                      placeholder="Query durchsuchen…"
                      className="h-8 pl-8 text-xs"
                      aria-label="Query-Log durchsuchen"
                    />
                  </div>
                  <Select
                    value={historyFilter}
                    onValueChange={(value) => setHistoryFilter(value as HistoryFilter)}
                  >
                    <SelectTrigger size="sm" className="h-8 w-32 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Alle Status</SelectItem>
                      <SelectItem value="success">Erfolgreich</SelectItem>
                      <SelectItem value="error">Fehler</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={range} onValueChange={(value) => setRange(value as HistoryRange)}>
                    <SelectTrigger size="sm" className="h-8 w-40 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="24h">Letzte 24 Stunden</SelectItem>
                      <SelectItem value="7d">Letzte 7 Tage</SelectItem>
                      <SelectItem value="all">Gesamter Verlauf</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <CardContent className="p-0">
                  {filteredHistory.length === 0 ? (
                    <p className="px-6 py-10 text-center text-xs text-muted-foreground">
                      Keine Log-Einträge für die aktuelle Auswahl.
                    </p>
                  ) : (
                    <div className="divide-y divide-border/60">
                      {filteredHistory.map((entry) => {
                        const expanded = expandedHistoryId === entry.id;
                        return (
                          <div key={entry.id} className="text-xs">
                            <button
                              type="button"
                              className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/35"
                              onClick={() => setExpandedHistoryId(expanded ? null : entry.id)}
                              aria-expanded={expanded}
                            >
                              <span className="w-16 shrink-0 font-mono text-[10px] text-muted-foreground">
                                {formatTime(entry.ranAt)}
                              </span>
                              <span className="min-w-0 flex-1 truncate font-mono" title={entry.sql}>
                                {firstLine(entry.sql)}
                              </span>
                              <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
                                {formatMs(entry.durationMs)}
                              </span>
                              <span className="hidden shrink-0 text-[10px] text-muted-foreground sm:inline">
                                {entry.rowCount == null
                                  ? "—"
                                  : `${entry.rowCount.toLocaleString("de-DE")} Zeilen`}
                              </span>
                              <Badge
                                variant={entry.error ? "destructive" : "secondary"}
                                className="shrink-0 px-1.5 py-0 text-[10px]"
                              >
                                {entry.error ? "Fehler" : "OK"}
                              </Badge>
                            </button>
                            {expanded && (
                              <div className="space-y-2 border-t bg-muted/20 px-4 py-3">
                                <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-words rounded-lg border bg-background p-3 font-mono text-[11px] leading-relaxed">
                                  {entry.sql}
                                </pre>
                                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-muted-foreground">
                                  <span>{formatDateTime(entry.ranAt)}</span>
                                  <span>Laufzeit {formatMs(entry.durationMs)}</span>
                                  <span>
                                    {entry.rowCount == null
                                      ? "Keine Zeilenangabe"
                                      : `${entry.rowCount.toLocaleString("de-DE")} Zeilen`}
                                  </span>
                                </div>
                                {entry.error && (
                                  <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-[11px] text-destructive">
                                    {entry.error}
                                  </p>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="activity" className="mt-5 space-y-5">
            <div className="grid grid-cols-2 divide-x divide-border/70 overflow-hidden rounded-2xl border bg-card md:grid-cols-4">
              {[
                {
                  label: "Sessions",
                  value: capabilities.sessions
                    ? sessionsQuery.isPending
                      ? "…"
                      : (sessionsQuery.data?.length ?? 0).toLocaleString("de-DE")
                    : "—",
                  detail: capabilities.sessions ? "Alle Verbindungen" : "Nicht verfügbar",
                  icon: ActivityIcon,
                },
                {
                  label: "Aktiv",
                  value:
                    capabilities.sessions && activeSessions != null
                      ? activeSessions.toLocaleString("de-DE")
                      : "—",
                  detail: "Laufende Queries",
                  icon: GaugeIcon,
                },
                {
                  label: "Blockiert",
                  value:
                    capabilities.sessions && blockedSessions != null
                      ? blockedSessions.toLocaleString("de-DE")
                      : "—",
                  detail: "Warten auf andere Sessions",
                  icon: AlertTriangleIcon,
                },
                {
                  label: "Locks",
                  value: capabilities.locks
                    ? locksQuery.isPending
                      ? "…"
                      : (locksQuery.data?.length ?? 0).toLocaleString("de-DE")
                    : "—",
                  detail: capabilities.locks ? "Aktuelle Locks" : "Nicht verfügbar",
                  icon: LockKeyhole,
                },
              ].map(({ label, value, detail, icon: Icon }) => (
                <div key={label} className="min-w-0 px-5 py-5">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Icon className="size-3.5 text-primary" />
                    {label}
                  </div>
                  <p className="mt-2 text-2xl font-medium tracking-tight">{value}</p>
                  <p className="mt-1 truncate text-[10px] text-muted-foreground">{detail}</p>
                </div>
              ))}
            </div>

            <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(300px,0.8fr)]">
              <Card size="sm">
                <CardHeader className="border-b">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <ActivityIcon className="size-4 text-primary" />
                    Aktive Sessions
                  </CardTitle>
                  <CardDescription>
                    Laufende und wartende Sessions, automatisch alle 5 Sekunden aktualisiert.
                  </CardDescription>
                  <CardAction>
                    <Link to="/sessions" className="text-xs text-primary hover:underline">
                      Vollständige Ansicht
                    </Link>
                  </CardAction>
                </CardHeader>
                <CardContent className="p-0">
                  {!capabilities.sessions ? (
                    <p className="px-6 py-8 text-center text-xs text-muted-foreground">
                      Dieser Provider unterstützt keine Session-Übersicht.
                    </p>
                  ) : sessionsQuery.isPending ? (
                    <div className="flex items-center justify-center gap-2 px-6 py-8 text-xs text-muted-foreground">
                      <Spinner />
                      Sessions werden geladen…
                    </div>
                  ) : sessionsQuery.isError ? (
                    <p className="px-6 py-8 text-center text-xs text-destructive">
                      {String(sessionsQuery.error)}
                    </p>
                  ) : visibleSessions.length === 0 ? (
                    <p className="px-6 py-8 text-center text-xs text-muted-foreground">
                      Keine Sessions gefunden.
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead className="border-b bg-muted/30 text-left text-muted-foreground">
                          <tr>
                            <th className="px-4 py-2 font-medium">Status</th>
                            <th className="px-4 py-2 font-medium">Benutzer / App</th>
                            <th className="px-4 py-2 font-medium">Query</th>
                            <th className="px-4 py-2 font-medium">Wartet auf</th>
                            <th className="px-4 py-2 text-right font-medium">Alter</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/60">
                          {visibleSessions.map((session) => (
                            <tr key={session.pid} className="hover:bg-muted/30">
                              <td className="whitespace-nowrap px-4 py-2.5">
                                <Badge
                                  variant={sessionStateVariant(session)}
                                  className="px-1.5 py-0 text-[10px]"
                                >
                                  {session.blocked_by.length > 0
                                    ? "blockiert"
                                    : session.state || "unbekannt"}
                                </Badge>
                              </td>
                              <td className="max-w-44 px-4 py-2.5">
                                <span className="block truncate">{session.user || "—"}</span>
                                <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                                  {session.application || session.database || "—"}
                                </span>
                              </td>
                              <td
                                className="max-w-[480px] truncate px-4 py-2.5 font-mono text-muted-foreground"
                                title={session.query}
                              >
                                {session.query || "—"}
                              </td>
                              <td className="px-4 py-2.5 text-muted-foreground">
                                {session.wait_event ||
                                  (session.blocked_by.length > 0
                                    ? session.blocked_by.join(", ")
                                    : "—")}
                              </td>
                              <td className="whitespace-nowrap px-4 py-2.5 text-right font-mono tabular-nums text-muted-foreground">
                                {formatElapsed(session.query_start)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card size="sm">
                <CardHeader className="border-b">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <LockKeyhole className="size-4 text-primary" />
                    Locks
                  </CardTitle>
                  <CardDescription>Aktuelle Sperren und wartende Lock-Anfragen.</CardDescription>
                  <CardAction>
                    <Link to="/sessions" className="text-xs text-primary hover:underline">
                      Details
                    </Link>
                  </CardAction>
                </CardHeader>
                <CardContent className="p-0">
                  {!capabilities.locks ? (
                    <p className="px-6 py-8 text-center text-xs text-muted-foreground">
                      Dieser Provider unterstützt keine Lock-Übersicht.
                    </p>
                  ) : locksQuery.isPending ? (
                    <div className="flex items-center justify-center gap-2 px-6 py-8 text-xs text-muted-foreground">
                      <Spinner />
                      Locks werden geladen…
                    </div>
                  ) : locksQuery.isError ? (
                    <p className="px-6 py-8 text-center text-xs text-destructive">
                      {String(locksQuery.error)}
                    </p>
                  ) : locksQuery.data?.length ? (
                    <div className="divide-y divide-border/60">
                      {locksQuery.data.slice(0, 14).map((lock) => (
                        <div
                          key={[
                            lock.pid,
                            lock.lock_type,
                            lock.relation ?? "",
                            lock.mode,
                            lock.granted,
                          ].join("|")}
                          className="flex items-center gap-3 px-4 py-2.5 text-xs"
                        >
                          <span className="w-12 shrink-0 font-mono tabular-nums">{lock.pid}</span>
                          <span className="min-w-0 flex-1 truncate font-mono">
                            {lock.relation || lock.lock_type}
                          </span>
                          <span className="shrink-0 text-[10px] text-muted-foreground">
                            {lock.mode}
                          </span>
                          <Badge
                            variant={lock.granted ? "secondary" : "destructive"}
                            className="shrink-0 px-1.5 py-0 text-[10px]"
                          >
                            {lock.granted ? "gewährt" : "wartet"}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="px-6 py-8 text-center text-xs text-muted-foreground">
                      Keine Locks vorhanden.
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </main>
  );
}
