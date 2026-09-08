import { useDeferredValue, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { QueryResult } from "@/lib/db";
import { useQueryWorkspace } from "@/lib/query-workspace";
import { QueryCellInspector } from "./query-cell-inspector";
import { QueryResultTable } from "./query-result-table";

export function QueryResultWorkbench({
  result,
  isLoading,
  error,
}: {
  result: QueryResult | null;
  isLoading: boolean;
  error: string | null;
}) {
  const workspace = useQueryWorkspace();
  const [search, setSearch] = useState("");
  const [cell, setCell] = useState<{ column: string; value: unknown; row: number } | null>(
    null,
  );
  const [lastResult, setLastResult] = useState(result);
  if (lastResult !== result) {
    setLastResult(result);
    setSearch("");
    setCell(null);
  }
  const term = useDeferredValue(search).trim().toLocaleLowerCase();
  const filtered = useMemo(
    () =>
      !result || !term
        ? result
        : {
            ...result,
            rows: result.rows.filter((row) =>
              result.columns.some((column) =>
                String(row[column] ?? "NULL")
                  .toLocaleLowerCase()
                  .includes(term),
              ),
            ),
          },
    [result, term],
  );
  if (isLoading || error)
    return <QueryResultTable result={result} isLoading={isLoading} error={error} />;
  if (!result)
    return (
      <div className="flex h-full items-center justify-center bg-muted/10 p-8">
        <div className="max-w-sm space-y-3 text-center">
          <div className="mx-auto flex size-10 items-center justify-center rounded-lg border bg-background font-mono text-lg text-muted-foreground">
            ↳
          </div>
          <p className="text-sm font-medium">Bereit für deine nächste Abfrage</p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            SQL schreiben, einen Bereich markieren oder ein einzelnes Statement ausführen.
            Ergebnisse und Meldungen erscheinen hier.
          </p>
        </div>
      </div>
    );
  if (!result.columns.length)
    return <QueryResultTable result={result} isLoading={false} error={null} />;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-1.5">
        <Input
          className="h-7 w-48 text-xs"
          aria-label="Ergebnisse durchsuchen"
          placeholder="Ergebnisse durchsuchen…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className="text-[10px] tabular-nums text-muted-foreground">
          {filtered?.rows.length} / {result.rows.length} Zeilen
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Button
            size="sm"
            className="h-7 text-xs"
            variant={workspace.resultView === "table" ? "secondary" : "ghost"}
            aria-pressed={workspace.resultView === "table"}
            onClick={() => workspace.update({ resultView: "table" })}
          >
            Tabelle
          </Button>
          <Button
            size="sm"
            className="h-7 text-xs"
            variant={workspace.resultView === "json" ? "secondary" : "ghost"}
            aria-pressed={workspace.resultView === "json"}
            onClick={() => workspace.update({ resultView: "json" })}
          >
            JSON
          </Button>
          <Button
            size="sm"
            className="h-7 text-xs"
            variant="ghost"
            title="Suchergebnisse als JSON kopieren; lokale Spaltenfilter und Sortierung gelten nur in der Tabelle"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(
                  JSON.stringify(filtered?.rows ?? [], null, 2),
                );
                toast.success("Suchergebnisse kopiert");
              } catch {
                toast.error("Ergebnisse konnten nicht kopiert werden");
              }
            }}
          >
            JSON kopieren
          </Button>
        </div>
      </div>
      {workspace.resultView === "json" ? (
        <pre
          className="min-h-0 flex-1 overflow-auto bg-muted/10 p-4 font-mono"
          style={{ fontSize: workspace.resultFontSize }}
        >
          {JSON.stringify(filtered?.rows ?? [], null, 2)}
        </pre>
      ) : (
        <div className="min-h-0 flex-1">
          <QueryResultTable
            result={filtered}
            isLoading={false}
            error={null}
            onInspect={(column, value, row) => setCell({ column, value, row })}
          />
        </div>
      )}
      <QueryCellInspector cell={cell} onClose={() => setCell(null)} />
    </div>
  );
}
