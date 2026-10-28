import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { QueryCellInspector } from "@/features/query/query-cell-inspector";
import { QueryResultTable } from "@/features/query/query-result-table";
import { copyWithToast } from "@/lib/clipboard";
import type { QueryResult } from "@/lib/db";
import type { SupabaseSqlResult as SqlResult } from "@/lib/db/supabase-studio-sql";
import { serializeRows } from "@/lib/export";

export function SupabaseSqlResult({
  result,
  error,
  running,
}: {
  result: SqlResult | null;
  error: string | null;
  running: boolean;
}) {
  const [cell, setCell] = useState<{ column: string; value: unknown; row: number } | null>(null);
  const table = useMemo<QueryResult | null>(
    () =>
      result && {
        columns: result.columns,
        rows: result.rows,
        rows_affected: null,
        execution_time_ms: result.duration_ms,
        truncated: result.truncated,
        notice: result.columns.length
          ? undefined
          : "Anweisung ausgeführt. Es wurden keine Zeilen zurückgegeben.",
      },
    [result],
  );

  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-md border">
      {result && !error && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-3 py-1.5 text-xs text-muted-foreground">
          <span className="font-medium text-foreground tabular-nums">
            {result.row_count} {result.row_count === 1 ? "Zeile" : "Zeilen"}
          </span>
          <span className="tabular-nums">{result.duration_ms} ms</span>
          {result.read_only && <span>Nur-Lesen</span>}
          {result.truncated && (
            <span className="text-amber-600 dark:text-amber-400">
              Angezeigt werden die ersten {result.rows.length} Zeilen.
            </span>
          )}
          {result.statement_count > 1 && (
            <span>
              {result.statement_count} Anweisungen ausgeführt, Ergebnis der letzten Anweisung.
            </span>
          )}
          {result.columns.length > 0 && (
            <div className="ml-auto flex gap-1">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={() =>
                  void copyWithToast(serializeRows(result.columns, result.rows, "csv"), "CSV")
                }
              >
                CSV kopieren
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={() =>
                  void copyWithToast(serializeRows(result.columns, result.rows, "json"), "JSON")
                }
              >
                JSON kopieren
              </Button>
            </div>
          )}
        </div>
      )}
      <div className="h-[420px] min-h-0">
        <QueryResultTable
          result={table}
          isLoading={running}
          error={error}
          kind="postgres"
          onInspect={(column, value, row) => setCell({ column, value, row })}
        />
      </div>
      <QueryCellInspector cell={cell} onClose={() => setCell(null)} />
    </div>
  );
}
