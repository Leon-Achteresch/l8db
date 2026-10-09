import { lazy, Suspense, useMemo, useState } from "react";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import {
  ACTIVITY_METRICS,
  LIVE_CHART_METRICS,
  type LiveChartMetric,
  liveChartRows,
} from "./live-chart-metrics";
import type { LiveMonitorState } from "./use-live-monitor";

const LiveActivityAreaChart = lazy(() =>
  import("./live-activity-area-chart").then((module) => ({
    default: module.LiveActivityAreaChart,
  })),
);

export function LiveActivityCard({
  m,
  title = "Datenbank-Aktivität",
  metrics,
}: {
  m: LiveMonitorState;
  title?: string;
  metrics?: LiveChartMetric[];
}) {
  const hasQueries = m.metrics?.queries_read != null;
  const hasCpu = m.latest?.cpu != null;
  const available = (metrics ?? ACTIVITY_METRICS).filter(
    (metric) => (metric !== "queries" || hasQueries) && (metric !== "cpu" || hasCpu),
  );
  const [chosen, setChosen] = useState<LiveChartMetric | null>(null);
  const metric = chosen && available.includes(chosen) ? chosen : (available[0] ?? "transactions");
  const definition = LIVE_CHART_METRICS[metric];
  const rows = useMemo(() => liveChartRows(m.points, metric), [m.points, metric]);

  return (
    <Card size="sm" className="min-w-0">
      <CardHeader className="flex flex-wrap items-center gap-3">
        <CardTitle className="text-sm">{title}</CardTitle>
        <Select value={metric} onValueChange={(value) => setChosen(value as LiveChartMetric)}>
          <SelectTrigger size="sm" className="h-7 w-48 text-xs" aria-label="Diagramm-Metrik">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {available.map((key) => (
              <SelectItem key={key} value={key}>
                {LIVE_CHART_METRICS[key].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <CardAction className="flex items-center gap-4 text-xs text-muted-foreground">
          {definition.series.map((series) => (
            <span key={series.key} className="flex items-center gap-1.5">
              <span className="size-2 rounded-full" style={{ backgroundColor: series.color }} />
              {series.label}
            </span>
          ))}
        </CardAction>
      </CardHeader>
      <CardContent>
        {!m.live ? (
          <div className="grid h-56 place-items-center rounded-xl border border-dashed text-center text-xs text-muted-foreground">
            Für diese Datenbank sind keine Live-Kennzahlen verfügbar.
          </div>
        ) : rows.length < 2 ? (
          <div className="grid h-56 place-items-center rounded-xl border border-dashed text-center text-xs text-muted-foreground">
            {m.paused ? "Aktualisierung pausiert." : "Messwerte werden gesammelt…"}
          </div>
        ) : (
          <Suspense
            fallback={
              <div className="flex h-56 items-center justify-center">
                <Spinner />
              </div>
            }
          >
            <LiveActivityAreaChart rows={rows} metric={metric} />
          </Suspense>
        )}
      </CardContent>
    </Card>
  );
}
