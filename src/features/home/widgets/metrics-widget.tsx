import { Database, Eye, FunctionSquare, Layers, ListOrdered, Package } from "lucide-react";
import { useActiveCapabilities } from "@/lib/db-selection";
import {
  useExtensionsQuery,
  useFunctionsQuery,
  useMaterializedViewsQuery,
  useSequencesQuery,
  useTablesQuery,
  useViewsQuery,
} from "@/lib/queries";
import { DashboardMetric } from "../dashboard-metric";

export function MetricsWidget() {
  const caps = useActiveCapabilities();
  const tables = useTablesQuery();
  const views = useViewsQuery();
  const functions = useFunctionsQuery();
  const extensions = useExtensionsQuery();
  const sequences = useSequencesQuery();
  const matviews = useMaterializedViewsQuery();
  const metrics = [
    { label: "Tabellen", query: tables, icon: Database, enabled: true },
    { label: "Views", query: views, icon: Eye, enabled: caps.views },
    { label: "Funktionen", query: functions, icon: FunctionSquare, enabled: caps.functions },
    { label: "Extensions", query: extensions, icon: Package, enabled: caps.extensions },
    { label: "Sequenzen", query: sequences, icon: ListOrdered, enabled: caps.sequences },
    { label: "Mat. Views", query: matviews, icon: Layers, enabled: caps.materialized_views },
  ].filter((metric) => metric.enabled);

  return (
    <section
      aria-label="Datenbankobjekte"
      className="grid h-full auto-cols-[minmax(130px,1fr)] grid-flow-col divide-x divide-border/70 overflow-x-auto overflow-y-hidden rounded-2xl border bg-card"
    >
      {metrics.map(({ label, query, icon }) => (
        <DashboardMetric
          key={label}
          label={label}
          value={query.data?.length}
          loading={query.isPending}
          error={query.isError}
          icon={icon}
        />
      ))}
    </section>
  );
}
