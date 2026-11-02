import { Skeleton } from "@/components/ui/skeleton";
import { useActiveCapabilities } from "@/lib/db-selection";
import {
  useDatabaseOverviewQuery,
  useExtensionsQuery,
  useFunctionsQuery,
  useMaterializedViewsQuery,
  useSequencesQuery,
  useTablesQuery,
  useViewsQuery,
} from "@/lib/queries";

const formatter = new Intl.NumberFormat("de-DE");

export function InventoryLine({ database, schema }: { database: string | null; schema: string }) {
  const caps = useActiveCapabilities();
  const overview = useDatabaseOverviewQuery();
  const tables = useTablesQuery();
  const views = useViewsQuery();
  const functions = useFunctionsQuery();
  const extensions = useExtensionsQuery();
  const sequences = useSequencesQuery();
  const matviews = useMaterializedViewsQuery();
  const sized = (overview.data?.size_bytes ?? 0) > 0;
  const items = [
    { one: "Tabelle", many: "Tabellen", query: tables, enabled: true },
    { one: "View", many: "Views", query: views, enabled: caps.views },
    { one: "Mat. View", many: "Mat. Views", query: matviews, enabled: caps.materialized_views },
    { one: "Funktion", many: "Funktionen", query: functions, enabled: caps.functions },
    { one: "Sequenz", many: "Sequenzen", query: sequences, enabled: caps.sequences },
    { one: "Extension", many: "Extensions", query: extensions, enabled: caps.extensions },
  ].filter(
    (item) =>
      item.enabled &&
      !item.query.isError &&
      (item.query.isPending || item.query.data?.length || item.one === "Tabelle"),
  );

  return (
    <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 text-[13px] text-muted-foreground">
      {database && <span className="font-mono text-foreground">{database}</span>}
      {sized && <span className="tabular-nums text-foreground">{overview.data?.size_pretty}</span>}
      {(database || sized) && (
        <span aria-hidden="true" className="text-border">
          /
        </span>
      )}
      {caps.schemas && <span className="font-mono">{schema}</span>}
      {items.map(({ one, many, query }) => (
        <span key={many} className="flex items-baseline gap-1">
          {query.isPending ? (
            <Skeleton className="inline-block h-3 w-5 translate-y-0.5" />
          ) : (
            <span className="font-medium tabular-nums text-foreground">
              {formatter.format(query.data?.length ?? 0)}
            </span>
          )}
          {query.data?.length === 1 ? one : many}
        </span>
      ))}
    </div>
  );
}
