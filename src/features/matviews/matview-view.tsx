import { useState } from "react";

import type { SortingState } from "@tanstack/react-table";
import { useQueryClient } from "@tanstack/react-query";
import { RefreshCwIcon, RefreshCwOffIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/features/table/data-table";
import { TableDataError } from "@/features/table/table-data-error";
import { TableDataSkeleton } from "@/features/table/table-data-skeleton";
import { useActiveConnection } from "@/lib/connections";
import { effectiveConnectionString } from "@/lib/ssh";
import { dropMaterializedView, refreshMaterializedView } from "@/lib/db";
import { useActiveDatabase } from "@/lib/db-selection";
import {
  useMaterializedViewsQuery,
  useTableRowCountQuery,
  useTableRowsQuery,
} from "@/lib/queries";
import { useSettingsStore } from "@/lib/settings";

interface MatviewViewProps {
  schema: string;
  name: string;
}

export function MatviewView({ schema, name }: MatviewViewProps) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const queryClient = useQueryClient();
  const rowLimit = useSettingsStore((s) => s.rowLimit);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState<"refresh" | "concurrent" | "drop" | null>(null);

  const { data: matviews } = useMaterializedViewsQuery(schema);
  const info = matviews?.find((m) => m.name === name);
  const { data, isLoading, isFetching, isError, error } = useTableRowsQuery(
    schema,
    name,
    undefined,
    sorting,
    true,
    page,
    true,
  );
  const { data: totalCount } = useTableRowCountQuery(schema, name, undefined, true);

  const refreshQueries = () => {
    void queryClient.invalidateQueries({ queryKey: ["matviews"] });
    void queryClient.invalidateQueries({ queryKey: ["rows"] });
    void queryClient.invalidateQueries({ queryKey: ["count"] });
  };

  const handleRefresh = async (concurrently: boolean) => {
    if (!connection || busy) return;
    setBusy(concurrently ? "concurrent" : "refresh");
    try {
      await refreshMaterializedView(
        connection.kind,
        effectiveConnectionString(connection),
        schema,
        name,
        concurrently,
        database ?? undefined,
      );
      toast.success(
        concurrently
          ? "Concurrently aktualisiert (lesbar geblieben)."
          : "Materialized View aktualisiert.",
      );
      setPage(0);
      refreshQueries();
    } catch (err) {
      toast.error(typeof err === "string" ? err : String(err));
    } finally {
      setBusy(null);
    }
  };

  const handleDrop = async () => {
    if (!connection || busy) return;
    if (!window.confirm(`Materialized View "${schema}.${name}" wirklich löschen?`)) return;
    setBusy("drop");
    try {
      await dropMaterializedView(
        connection.kind,
        effectiveConnectionString(connection),
        schema,
        name,
        database ?? undefined,
      );
      toast.success("Materialized View gelöscht.");
      refreshQueries();
    } catch (err) {
      toast.error(typeof err === "string" ? err : String(err));
    } finally {
      setBusy(null);
    }
  };

  if (!connection) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">Keine Verbindung aktiv.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-muted/30 px-3 py-2">
        <span className="font-mono text-sm font-medium">
          {schema}.{name}
        </span>
        <Badge variant={info?.is_populated === false ? "destructive" : "secondary"}>
          {info?.is_populated === false ? "leer (NO DATA)" : "Materialized View"}
        </Badge>
        <div className="ml-auto flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1.5 px-2.5 text-xs"
            onClick={() => void handleRefresh(false)}
            disabled={busy !== null}
            title="Blockiert Leser während des Aufbaus"
          >
            <RefreshCwIcon className="size-3.5" />
            {busy === "refresh" ? "Aktualisiere…" : "Aktualisieren"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1.5 px-2.5 text-xs"
            onClick={() => void handleRefresh(true)}
            disabled={busy !== null}
            title="Benötigt einen Unique-Index, blockiert keine Leser"
          >
            <RefreshCwOffIcon className="size-3.5" />
            {busy === "concurrent" ? "Aktualisiere…" : "Concurrently"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1.5 px-2.5 text-xs text-muted-foreground hover:text-destructive"
            onClick={() => void handleDrop()}
            disabled={busy !== null}
          >
            <Trash2Icon className="size-3.5" />
            Löschen
          </Button>
        </div>
      </div>

      {info?.definition && (
        <details className="shrink-0 border-b bg-muted/20 px-4 py-2">
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
            Definition anzeigen
          </summary>
          <pre className="mt-2 max-h-40 overflow-auto font-mono text-xs whitespace-pre-wrap">
            {info.definition}
          </pre>
        </details>
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {isLoading ? (
          <TableDataSkeleton />
        ) : isError ? (
          <TableDataError title="Fehler beim Laden" error={error} />
        ) : (
          <DataTable
            className="h-full min-h-0 flex-1"
            columns={data?.columns ?? []}
            data={data?.rows ?? []}
            emptyMessage="Keine Daten. Ggf. REFRESH ausführen."
            sorting={sorting}
            onSortingChange={setSorting}
            isFetching={isFetching}
            page={page}
            totalCount={totalCount ?? undefined}
            pageSize={rowLimit}
            onPageChange={setPage}
            currentSchema={schema}
            currentTable={name}
          />
        )}
      </div>
    </div>
  );
}
