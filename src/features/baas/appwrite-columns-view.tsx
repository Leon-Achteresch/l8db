import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Columns3, RefreshCw } from "lucide-react";
import { useState } from "react";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { appwriteColumns } from "@/lib/db";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";

export function AppwriteColumnsView({
  id,
  databaseId,
  tableId,
}: {
  id: string;
  databaseId: string;
  tableId: string;
}) {
  const [offset, setOffset] = useState(0);
  const feature = useNewFeatureVisibility<HTMLDivElement>("baas.appwrite.columns");
  const columns = useQuery({
    queryKey: ["appwrite", id, "columns", databaseId, tableId, offset],
    queryFn: () => appwriteColumns(id, databaseId, tableId, offset),
  });

  return (
    <div className="mt-4 border-t pt-4">
      <div ref={feature.ref} className="flex items-center gap-2">
        <Columns3 className="size-3.5 text-muted-foreground" />
        <h5 className="text-xs font-medium">Spalten</h5>
        {feature.isNew && <NewBadge />}
        {columns.data && (
          <span className="text-xs text-muted-foreground">{columns.data.total}</span>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          className="ml-auto"
          aria-label="Spalten aktualisieren"
          onClick={() => void columns.refetch()}
          disabled={columns.isFetching}
        >
          <RefreshCw className={`size-3.5 ${columns.isFetching ? "animate-spin" : ""}`} />
        </Button>
      </div>
      {columns.isPending ? (
        <p className="mt-3 text-xs text-muted-foreground">Spalten werden geladen…</p>
      ) : columns.isError ? (
        <p role="alert" className="mt-3 text-xs text-destructive">
          {String(columns.error)}
        </p>
      ) : columns.data.items.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">Keine Spalten vorhanden.</p>
      ) : (
        <div className="mt-3 max-h-56 divide-y overflow-auto">
          {columns.data.items.map((column) => (
            <div key={column.key} className="flex items-start justify-between gap-2 py-2 text-xs">
              <span className="min-w-0 break-all font-mono font-medium">{column.key}</span>
              <span className="shrink-0 text-right text-[11px] text-muted-foreground">
                {column.kind}
                {column.array ? "[]" : ""}
                {column.required ? " · Pflicht" : ""}
                {column.status && column.status !== "available" ? ` · ${column.status}` : ""}
              </span>
            </div>
          ))}
        </div>
      )}
      {columns.data && (offset > 0 || offset + columns.data.items.length < columns.data.total) && (
        <div className="mt-3 flex items-center justify-end gap-2 border-t pt-3">
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Vorherige Spalten"
            disabled={offset === 0}
            onClick={() => setOffset((value) => Math.max(0, value - 100))}
          >
            <ChevronLeft className="size-3.5" />
          </Button>
          <span className="text-xs text-muted-foreground">
            {offset + 1}–{offset + columns.data.items.length} / {columns.data.total}
          </span>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Weitere Spalten"
            disabled={offset + columns.data.items.length >= columns.data.total}
            onClick={() => setOffset((value) => value + 100)}
          >
            <ChevronRight className="size-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}
