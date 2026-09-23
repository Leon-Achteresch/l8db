import { useNavigate } from "@tanstack/react-router";
import { ListChecksIcon, RefreshCw, SquareArrowOutUpRightIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { firstLine, formatMs } from "@/features/monitor/monitor-view/format";
import type { WorkloadReplayState } from "@/features/monitor/monitor-view/use-workload-replay";
import type { DatabaseKind } from "@/lib/db";
import { useQueryStatsQuery } from "@/lib/queries";
import { QUERY_STATS_DEFAULT_LIMIT, QUERY_STATS_LIMITS, queryStatsSource } from "@/lib/query-stats";
import { useTableTabs } from "@/lib/table-tabs";
import { statementsFromStats } from "@/lib/workload";

interface QueryStatsCardProps {
  kind: DatabaseKind;
  supported: boolean;
  replay: WorkloadReplayState;
}

function formatCount(value: number | null): string {
  return value === null ? "—" : value.toLocaleString("de-DE", { maximumFractionDigits: 0 });
}

export function QueryStatsCard({ kind, supported, replay }: QueryStatsCardProps) {
  const navigate = useNavigate();
  const [limit, setLimit] = useState(QUERY_STATS_DEFAULT_LIMIT);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const stats = useQueryStatsQuery(limit, supported);
  const entries = useMemo(() => stats.data ?? [], [stats.data]);
  const source = queryStatsSource(kind);

  const toggle = (index: number, checked: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(index);
      else next.delete(index);
      return next;
    });

  const openInEditor = (sql: string) => {
    const id = useTableTabs.getState().openQueryTabWithSql(sql, "Top-Statement");
    void navigate({ to: "/query/$id", params: { id } });
  };

  const takeSelection = () => {
    const chosen = entries.filter((_, index) => selected.has(index));
    replay.setWorkload(statementsFromStats(chosen.length > 0 ? chosen : entries));
  };

  return (
    <Card size="sm">
      <CardHeader className="border-b">
        <CardTitle className="flex items-center gap-2 text-sm">
          <ListChecksIcon className="size-4 text-primary" />
          Top-Statements des Servers
        </CardTitle>
        <CardDescription>
          {source
            ? `Nach Gesamtlaufzeit sortiert, Quelle ${source}. Zeigt Last aller Clients, nicht nur von l8db.`
            : "Diese Datenbank stellt keine Statement-Statistik bereit."}
        </CardDescription>
        {supported && (
          <CardAction className="flex items-center gap-2">
            <Select value={String(limit)} onValueChange={(value) => setLimit(Number(value))}>
              <SelectTrigger size="sm" className="h-7 w-24 text-xs" aria-label="Anzahl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {QUERY_STATS_LIMITS.map((value) => (
                  <SelectItem key={value} value={String(value)} className="text-xs">
                    Top {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => void stats.refetch()}
              disabled={stats.isFetching}
              aria-label="Statistik neu laden"
            >
              <RefreshCw className={stats.isFetching ? "size-3.5 animate-spin" : "size-3.5"} />
            </Button>
          </CardAction>
        )}
      </CardHeader>
      {supported && (
        <CardContent className="p-0">
          {stats.isPending ? (
            <div className="flex items-center gap-2 px-6 py-8 text-xs text-muted-foreground">
              <Spinner />
              Statistik wird geladen…
            </div>
          ) : stats.isError ? (
            <p className="px-6 py-6 text-xs text-destructive">{String(stats.error.message)}</p>
          ) : entries.length === 0 ? (
            <p className="px-6 py-8 text-center text-xs text-muted-foreground">
              Der Server hat noch keine Statements erfasst.
            </p>
          ) : (
            <>
              <div className="max-h-96 overflow-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 border-b bg-card text-left text-muted-foreground">
                    <tr>
                      <th className="w-8 px-3 py-2" />
                      <th className="px-3 py-2 font-medium">Statement</th>
                      <th className="px-3 py-2 text-right font-medium">Aufrufe</th>
                      <th className="px-3 py-2 text-right font-medium">Gesamt</th>
                      <th className="px-3 py-2 text-right font-medium">Ø</th>
                      <th className="px-3 py-2 text-right font-medium">Max</th>
                      <th className="px-3 py-2 text-right font-medium">Zeilen</th>
                      <th className="w-8 px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {entries.map((entry, index) => (
                      <tr key={`${index}-${entry.sql}`} className="hover:bg-muted/30">
                        <td className="px-3 py-2">
                          <Checkbox
                            checked={selected.has(index)}
                            onCheckedChange={(checked) => toggle(index, checked === true)}
                            aria-label="Für Workload auswählen"
                          />
                        </td>
                        <td
                          className="max-w-[560px] truncate px-3 py-2 font-mono"
                          title={entry.sql}
                        >
                          {firstLine(entry.sql)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">
                          {formatCount(entry.calls)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">
                          {formatMs(entry.totalMs)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">
                          {entry.meanMs === null ? "—" : `${entry.meanMs.toFixed(2)} ms`}
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">
                          {formatMs(entry.maxMs)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">
                          {formatCount(entry.rows)}
                        </td>
                        <td className="px-3 py-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="size-6 p-0"
                            title="Im SQL-Editor öffnen"
                            onClick={() => openInEditor(entry.sql)}
                          >
                            <SquareArrowOutUpRightIcon className="size-3.5" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center gap-2 border-t px-4 py-2.5">
                <Button size="sm" className="h-7 text-xs" onClick={takeSelection}>
                  {selected.size > 0
                    ? `${selected.size} als Workload übernehmen`
                    : "Alle als Workload übernehmen"}
                </Button>
                {selected.size > 0 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    onClick={() => setSelected(new Set())}
                  >
                    Auswahl aufheben
                  </Button>
                )}
              </div>
            </>
          )}
        </CardContent>
      )}
    </Card>
  );
}
