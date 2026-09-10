import { useEffect, useState } from "react";

import { getRouteApi } from "@tanstack/react-router";
import type { SortingState } from "@tanstack/react-table";
import { TriangleAlertIcon } from "lucide-react";

import { DataTable } from "@/components/table/data-table";
import { TableFilterPanel } from "@/components/table/table-filter-panel";
import { TableViewsPanel } from "@/components/table/table-views-panel";
import { ViewDefinitionPanel } from "@/components/table/view-definition-panel";
import { Skeleton } from "@/components/ui/skeleton";
import { useActiveConnection } from "@/lib/connections";
import { useTableRowsQuery, useUpdateRowMutation } from "@/lib/queries";
import { useTableTabs } from "@/lib/table-tabs";

const routeApi = getRouteApi("/_app/tables/$schema/$table");

export function TablePage() {
  const { schema, table } = routeApi.useParams();
  const { type } = routeApi.useSearch();
  const isView = type === "view";
  const connection = useActiveConnection();
  const openTab = useTableTabs((state) => state.openTab);
  const [filter, setFilter] = useState("");
  const [sorting, setSorting] = useState<SortingState>([]);
  const { data, isLoading, isFetching, isError, error } = useTableRowsQuery(
    schema,
    table,
    filter,
    sorting,
    isView,
  );
  const updateRowMutation = useUpdateRowMutation(schema, table);

  useEffect(() => {
    openTab({ schema, table });
  }, [schema, table, openTab]);

  useEffect(() => {
    setFilter("");
    setSorting([]);
  }, [schema, table]);

  if (!connection) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 bg-background">
        <p className="text-sm text-muted-foreground font-medium">Keine Verbindung aktiv.</p>
      </div>
    );
  }

  const emptyMessage =
    filter.trim() === ""
      ? "Keine Daten."
      : "Keine Zeilen für diesen Filter.";

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {isView ? (
        <ViewDefinitionPanel schema={schema} view={table} />
      ) : null}
      {!isView ? (
        <TableViewsPanel
          schema={schema}
          table={table}
          activeFilter={filter}
          onSelectView={setFilter}
        />
      ) : null}
      {!isView ? (
        <div className="flex min-h-0 max-h-[min(28rem,55%)] shrink-0 flex-col overflow-hidden">
          <TableFilterPanel
            key={`${schema}.${table}`}
            columns={data?.columns ?? []}
            activeFilter={filter}
            onApply={setFilter}
          />
        </div>
      ) : null}

      {isLoading ? (
        <div className="flex-1 overflow-hidden border-t border-border bg-background p-4 space-y-3 select-none">
          <div className="flex gap-2">
            <Skeleton className="h-8 w-24 bg-muted/50" />
            <Skeleton className="h-8 w-32 bg-muted/50" />
            <Skeleton className="h-8 w-20 bg-muted/50" />
            <Skeleton className="h-8 w-40 bg-muted/50" />
          </div>
          <div className="space-y-3 mt-4">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="flex gap-3 items-center">
                <Skeleton className="h-5 w-8 rounded-sm bg-muted/30" />
                <Skeleton className="h-5 flex-1 rounded-sm bg-muted/30" />
                <Skeleton className="h-5 flex-1 rounded-sm bg-muted/30" />
                <Skeleton className="h-5 flex-1 rounded-sm bg-muted/30" />
                <Skeleton className="h-5 flex-1 rounded-sm bg-muted/30" />
              </div>
            ))}
          </div>
        </div>
      ) : isError ? (
        <div className="flex flex-1 items-center justify-center p-6 border-t border-border bg-background">
          <div className="flex flex-col items-center gap-3 max-w-md text-center p-6 rounded-lg border border-destructive/20 bg-destructive/5 shadow-xs">
            <TriangleAlertIcon className="size-8 text-destructive animate-bounce" />
            <h3 className="text-sm font-semibold text-destructive">Fehler beim Laden der Tabelle</h3>
            <p className="text-xs text-muted-foreground font-mono bg-destructive/[0.02] p-2.5 rounded border border-destructive/10 break-all select-text">
              {String(error)}
            </p>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden border-t border-border">
          <DataTable
            className="min-h-0 flex-1"
            columns={data?.columns ?? []}
            data={data?.rows ?? []}
            emptyMessage={emptyMessage}
            sorting={sorting}
            onSortingChange={setSorting}
            isFetching={isFetching}
            onSaveRow={isView ? undefined : (ctid, updates) => updateRowMutation.mutateAsync({ ctid, updates })}
            onApplyFilter={setFilter}
          />
        </div>
      )}
    </div>
  );
}
