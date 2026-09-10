import { useEffect, useLayoutEffect, useState } from "react";

import { getRouteApi } from "@tanstack/react-router";
import type { SortingState } from "@tanstack/react-table";

import { DataTable } from "@/components/table/data-table";
import { TableFilterPanel } from "@/components/table/table-filter-panel";
import { Spinner } from "@/components/ui/spinner";
import { useActiveConnection } from "@/lib/connections";
import { useTableRowsQuery } from "@/lib/queries";
import { useTableTabs } from "@/lib/table-tabs";

const routeApi = getRouteApi("/_app/tables/$schema/$table");

export function TablePage() {
  const { schema, table } = routeApi.useParams();
  const connection = useActiveConnection();
  const openTab = useTableTabs((state) => state.openTab);
  const [filter, setFilter] = useState("");
  const [sorting, setSorting] = useState<SortingState>([]);
  const { data, isLoading, isFetching, isPending, isError, error } =
    useTableRowsQuery(schema, table, filter, sorting);

  useEffect(() => {
    openTab({ schema, table });
  }, [schema, table, openTab]);

  useLayoutEffect(() => {
    setFilter("");
    setSorting([]);
  }, [schema, table]);

  if (!connection) {
    return (
      <p className="text-sm text-muted-foreground">Keine Verbindung aktiv.</p>
    );
  }

  const emptyMessage =
    filter.trim() === ""
      ? "Keine Daten."
      : "Keine Zeilen für diesen Filter.";

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex min-h-0 max-h-[min(28rem,55%)] shrink-0 flex-col overflow-hidden">
        <TableFilterPanel
          key={`${schema}.${table}`}
          columns={data?.columns ?? []}
          activeFilter={filter}
          onApply={setFilter}
        />
      </div>

      {isLoading || isPending ? (
        <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
          <Spinner />
          Lade Daten…
        </div>
      ) : isError ? (
        <p className="p-3 text-sm text-destructive">{String(error)}</p>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden border-t border-border">
          <DataTable
            key={`${schema}.${table}`}
            className="min-h-0 flex-1"
            columns={data?.columns ?? []}
            data={data?.rows ?? []}
            emptyMessage={emptyMessage}
            sorting={sorting}
            onSortingChange={setSorting}
            isFetching={isFetching}
          />
        </div>
      )}
    </div>
  );
}
