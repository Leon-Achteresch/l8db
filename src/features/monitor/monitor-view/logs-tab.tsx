import { SearchIcon, SquareTerminal, TerminalIcon } from "lucide-react";

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
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { TabsContent } from "@/components/ui/tabs";
import {
  firstLine,
  formatDateTime,
  formatMs,
  formatTime,
  levelVariant,
} from "@/features/monitor/monitor-view/format";
import type { HistoryFilter, HistoryRange } from "@/features/monitor/monitor-view/types";
import type { MonitorViewState } from "@/features/monitor/monitor-view/use-monitor-view";
import type { ServerOutputEntry } from "@/lib/server-output";

export function LogsTab({
  m,
  connection,
}: {
  m: MonitorViewState;
  connection: NonNullable<MonitorViewState["connection"]>;
}) {
  const {
    capabilities,
    clearHistory,
    serverOutputEnabled,
    clearServerOutput,
    range,
    setRange,
    historyFilter,
    setHistoryFilter,
    historySearch,
    setHistorySearch,
    expandedHistoryId,
    setExpandedHistoryId,
    serverOutputBusy,
    scopedHistory,
    filteredHistory,
    scopedServerOutput,
    toggleServerOutput,
  } = m;
  return (
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
                          <span className="mt-1 block text-muted-foreground">{entry.detail}</span>
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
  );
}
