import { RefreshCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/features/table/data-table";
import { useMasterDetailQuery } from "@/lib/hooks/use-master-detail-query";

export function MasterDetailResult({
  source,
  sql,
  column,
  preview = false,
}: {
  source: string;
  sql: string;
  column?: string;
  preview?: boolean;
}) {
  const { query, selection, supported, waiting, error } = useMasterDetailQuery(source, sql, column);
  if (!supported)
    return (
      <p role="alert" className="p-4 text-sm text-muted-foreground">
        Diese Verbindung unterstützt keine SQL-Bind-Parameter für Master-Detail.
      </p>
    );
  if (error)
    return (
      <p role="alert" className="p-4 text-sm text-destructive">
        {error}
      </p>
    );
  if (!selection)
    return (
      <p className="p-4 text-sm text-muted-foreground">
        Wähle eine Zelle im Master, um die Details zu laden.
      </p>
    );
  if (waiting || query.isPending)
    return (
      <p role="status" className="p-4 text-sm text-muted-foreground">
        Details werden geladen…
      </p>
    );
  if (query.error)
    return (
      <div role="alert" className="overflow-auto p-4 text-sm text-destructive">
        <p>{query.error.message}</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => void query.refetch()}>
          Erneut versuchen
        </Button>
      </div>
    );
  const count = query.data?.rows.length ?? 0;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b bg-muted/20 px-3 py-1.5 text-xs text-muted-foreground">
        <span className="min-w-0 flex-1">
          {preview ? "Vorschau" : "Details"} · {count} {count === 1 ? "Datensatz" : "Datensätze"} ·
          Master-Zeile {selection.rowIndex + 1}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Details aktualisieren"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          <RefreshCwIcon className="size-3" />
        </Button>
      </div>
      <DataTable
        columns={query.data?.columns ?? []}
        data={query.data?.rows ?? []}
        emptyMessage="Keine passenden Details für diese Master-Zeile."
        sorting={[]}
        sortableColumns={[]}
        onSortingChange={() => {}}
        isFetching={query.isFetching}
      />
    </div>
  );
}
