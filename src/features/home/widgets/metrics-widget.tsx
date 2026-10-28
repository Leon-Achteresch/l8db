import { Skeleton } from "@/components/ui/skeleton";
import { useActiveCapabilities } from "@/lib/db-selection";
import {
  useExtensionsQuery,
  useFunctionsQuery,
  useMaterializedViewsQuery,
  useSequencesQuery,
  useTablesQuery,
  useViewsQuery,
} from "@/lib/queries";

const formatter = new Intl.NumberFormat("de-DE");

export function MetricsWidget() {
  const caps = useActiveCapabilities();
  const tables = useTablesQuery();
  const views = useViewsQuery();
  const functions = useFunctionsQuery();
  const extensions = useExtensionsQuery();
  const sequences = useSequencesQuery();
  const matviews = useMaterializedViewsQuery();
  const metrics = [
    { label: "Tabellen", query: tables, color: "var(--chart-1)", enabled: true },
    { label: "Views", query: views, color: "var(--chart-2)", enabled: caps.views },
    { label: "Funktionen", query: functions, color: "var(--chart-3)", enabled: caps.functions },
    { label: "Extensions", query: extensions, color: "var(--chart-4)", enabled: caps.extensions },
    { label: "Sequenzen", query: sequences, color: "var(--chart-5)", enabled: caps.sequences },
    {
      label: "Mat. Views",
      query: matviews,
      color: "var(--muted-foreground)",
      enabled: caps.materialized_views,
    },
  ].filter((metric) => metric.enabled);
  const total = metrics.reduce((sum, metric) => sum + (metric.query.data?.length ?? 0), 0);

  return (
    <section
      aria-label="Datenbankobjekte"
      className="flex h-full flex-col justify-between gap-3 overflow-hidden rounded-xl border bg-card px-5 py-3.5"
    >
      <dl className="grid auto-cols-[minmax(96px,1fr)] grid-flow-col gap-4 overflow-x-auto">
        {metrics.map(({ label, query, color }) => (
          <div key={label} className="min-w-0">
            <dt className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="size-2 shrink-0 rounded-[3px]" style={{ background: color }} />
              <span className="truncate">{label}</span>
            </dt>
            <dd className="mt-0.5 text-xl font-semibold tracking-tight tabular-nums">
              {query.isPending ? (
                <Skeleton className="mt-1 h-6 w-10" />
              ) : query.isError ? (
                <span title="Konnte nicht geladen werden">—</span>
              ) : (
                formatter.format(query.data?.length ?? 0)
              )}
            </dd>
          </div>
        ))}
      </dl>
      <div
        aria-hidden="true"
        className="flex h-1.5 shrink-0 gap-0.5 overflow-hidden rounded-full bg-muted"
      >
        {total > 0 &&
          metrics.map(({ label, query, color }) =>
            query.data?.length ? (
              <span
                key={label}
                title={`${label}: ${Math.round((query.data.length / total) * 100)} %`}
                className="h-full transition-[flex-grow] duration-500 motion-reduce:transition-none"
                style={{ flexGrow: query.data.length, background: color }}
              />
            ) : null,
          )}
      </div>
    </section>
  );
}
