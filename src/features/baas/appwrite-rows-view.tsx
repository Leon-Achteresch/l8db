import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { useState } from "react";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { appwriteRows } from "@/lib/db";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";

function displayValue(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2) ?? "—";
}

export function AppwriteRowsView({
  id,
  databaseId,
  tableId,
}: {
  id: string;
  databaseId: string;
  tableId: string;
}) {
  const [offset, setOffset] = useState(0);
  const feature = useNewFeatureVisibility<HTMLDivElement>("baas.appwrite.rows");
  const rows = useQuery({
    queryKey: ["appwrite", id, "rows", databaseId, tableId, offset],
    queryFn: () => appwriteRows(id, databaseId, tableId, offset),
  });

  return (
    <div className="mt-4 border-t pt-4">
      <div ref={feature.ref} className="flex items-center gap-2">
        <h5 className="text-xs font-medium">Zeilen</h5>
        {feature.isNew && <NewBadge />}
        {rows.data && <span className="text-xs text-muted-foreground">{rows.data.total}</span>}
        <Button
          variant="ghost"
          size="icon-sm"
          className="ml-auto"
          aria-label="Zeilen aktualisieren"
          onClick={() => void rows.refetch()}
          disabled={rows.isFetching}
        >
          <RefreshCw className={`size-3.5 ${rows.isFetching ? "animate-spin" : ""}`} />
        </Button>
      </div>
      {rows.isPending ? (
        <p className="mt-3 text-xs text-muted-foreground">Zeilen werden geladen…</p>
      ) : rows.isError ? (
        <p role="alert" className="mt-3 text-xs text-destructive">
          {String(rows.error)}
        </p>
      ) : rows.data.items.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">Keine Zeilen vorhanden.</p>
      ) : (
        <div className="mt-3 divide-y">
          {rows.data.items.map((row) => {
            const label = [row.name, row.title, row.email].find(
              (value) => typeof value === "string" && value.length > 0,
            );
            return (
              <details key={row.$id} className="group py-2 first:pt-0">
                <summary className="cursor-pointer break-all text-xs font-medium">
                  {typeof label === "string" ? label : row.$id}
                  {typeof label === "string" && (
                    <>
                      {" "}
                      <span className="ml-2 font-mono text-[10px] font-normal text-muted-foreground">
                        {row.$id}
                      </span>
                    </>
                  )}
                </summary>
                <div className="mt-3 grid gap-2 rounded-xl bg-background/60 p-3">
                  {Object.entries(row)
                    .filter(([key]) => key !== "$id")
                    .map(([key, value]) => (
                      <div key={key} className="min-w-0">
                        <p className="text-[10px] text-muted-foreground">{key}</p>
                        <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all font-sans text-xs">
                          {displayValue(value)}
                        </pre>
                      </div>
                    ))}
                </div>
              </details>
            );
          })}
        </div>
      )}
      {rows.data && (offset > 0 || offset + rows.data.items.length < rows.data.total) && (
        <div className="mt-3 flex items-center justify-end gap-2 border-t pt-3">
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Vorherige Zeilen"
            disabled={offset === 0}
            onClick={() => setOffset((value) => Math.max(0, value - 100))}
          >
            <ChevronLeft className="size-3.5" />
          </Button>
          <span className="text-xs text-muted-foreground">
            {offset + 1}–{offset + rows.data.items.length} / {rows.data.total}
          </span>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Weitere Zeilen"
            disabled={offset + rows.data.items.length >= rows.data.total}
            onClick={() => setOffset((value) => value + 100)}
          >
            <ChevronRight className="size-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}
