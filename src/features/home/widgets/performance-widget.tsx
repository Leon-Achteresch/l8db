import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { lazy, Suspense, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { firstLine, formatMs, formatTime } from "@/features/monitor/monitor-view/format";
import { useActiveDatabase } from "@/lib/db-selection";
import { useQueryHistoryStore } from "@/lib/query-history";

const MonitorLatencyChart = lazy(() =>
  import("@/features/monitor/monitor-view/monitor-latency-chart").then((module) => ({
    default: module.MonitorLatencyChart,
  })),
);

const RANGE_MS = 7 * 24 * 60 * 60 * 1000;
const LATENCY_POINTS = 30;

export function PerformanceWidget({ connectionId }: { connectionId: string }) {
  const database = useActiveDatabase();
  const history = useQueryHistoryStore((state) => state.entries);
  const { stats, latency } = useMemo(() => {
    const cutoff = Date.now() - RANGE_MS;
    const scoped = history.filter(
      (entry) =>
        entry.connectionId === connectionId && entry.database === database && entry.ranAt >= cutoff,
    );
    const measured = scoped.filter(
      (entry) => typeof entry.durationMs === "number" && Number.isFinite(entry.durationMs),
    );
    const durations = measured.map((entry) => entry.durationMs ?? 0);
    const slowest = measured.reduce<(typeof measured)[number] | null>(
      (current, entry) =>
        !current || (entry.durationMs ?? 0) > (current.durationMs ?? 0) ? entry : current,
      null,
    );
    const errors = scoped.filter((entry) => Boolean(entry.error)).length;
    return {
      stats: [
        { label: "Queries", value: scoped.length.toLocaleString("de-DE"), detail: "Letzte 7 Tage" },
        {
          label: "Ø Laufzeit",
          value: formatMs(
            durations.length
              ? durations.reduce((sum, value) => sum + value, 0) / durations.length
              : null,
          ),
          detail: `${measured.length} gemessen`,
        },
        {
          label: "Langsamste",
          value: formatMs(slowest?.durationMs ?? null),
          detail: slowest ? firstLine(slowest.sql) : "Keine Messung",
        },
        {
          label: "Fehler",
          value: errors.toLocaleString("de-DE"),
          detail: scoped.length
            ? `${Math.round((errors / scoped.length) * 100)} % Anteil`
            : "Keine Queries",
        },
      ],
      latency: measured
        .slice(0, LATENCY_POINTS)
        .reverse()
        .map((entry) => ({ label: formatTime(entry.ranAt), duration: entry.durationMs ?? 0 })),
    };
  }, [history, connectionId, database]);

  return (
    <section className="@container flex h-full flex-col overflow-hidden rounded-2xl border bg-card">
      <div className="flex shrink-0 items-center justify-between border-b px-5 py-3">
        <h2 className="text-sm font-semibold">Performance</h2>
        <Button variant="ghost" size="sm" asChild className="h-7 text-xs">
          <Link to="/monitor">
            Monitor
            <ArrowRight className="size-3" />
          </Link>
        </Button>
      </div>
      <div className="grid shrink-0 grid-cols-2 gap-x-4 gap-y-3 border-b px-5 py-4 @md:grid-cols-4">
        {stats.map(({ label, value, detail }) => (
          <div key={label} className="min-w-0">
            <p className="text-[11px] text-muted-foreground">{label}</p>
            <p className="mt-1 truncate text-xl font-medium tracking-tight">{value}</p>
            <p className="truncate text-[10px] text-muted-foreground" title={detail}>
              {detail}
            </p>
          </div>
        ))}
      </div>
      <div className="min-h-0 flex-1 p-4">
        {latency.length === 0 ? (
          <div className="grid h-full place-items-center rounded-xl border border-dashed text-center text-xs text-muted-foreground">
            Noch keine Laufzeitdaten vorhanden.
          </div>
        ) : (
          <Suspense fallback={<Skeleton className="h-full w-full rounded-xl" />}>
            <MonitorLatencyChart data={latency} className="aspect-auto h-full w-full" />
          </Suspense>
        )}
      </div>
    </section>
  );
}
