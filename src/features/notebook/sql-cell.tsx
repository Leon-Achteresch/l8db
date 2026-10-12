import { CircleCheckIcon, CircleXIcon } from "lucide-react";
import { useMemo } from "react";
import { Spinner } from "@/components/ui/spinner";
import { ResultError } from "@/features/query/query-result-table/result-error";
import { QueryResultWorkbench } from "@/features/query/query-result-workbench";
import type { ResultChartBinding } from "@/features/query/result-chart/types";
import { formatRelative } from "@/lib/automation/format";
import { useConnectionsStore } from "@/lib/connections";
import type { QueryResult } from "@/lib/db";
import { type NotebookCell, type NotebookOutput, useNotebookStore } from "@/lib/notebook";
import { capabilitiesFor } from "@/lib/providers";
import { EMPTY_RESULT_CHART } from "@/lib/result-chart-store";
import { NotebookConnectionSelect } from "./notebook-connection-select";
import { NotebookSqlEditor } from "./notebook-sql-editor";

type SqlNotebookCell = Extract<NotebookCell, { type: "sql" }>;

export function SqlCell({
  cell,
  connectionId,
  output,
  running,
  onRun,
  onRunAll,
  onCancel,
}: {
  cell: SqlNotebookCell;
  connectionId: string | null;
  output: NotebookOutput | undefined;
  running: boolean;
  onRun: () => void;
  onRunAll: () => void;
  onCancel: () => void;
}) {
  const updateCell = useNotebookStore((s) => s.updateCell);
  const connection = useConnectionsStore((s) =>
    s.connections.find((c) => c.id === (cell.connectionId ?? connectionId)),
  );
  const result = useMemo<QueryResult | null>(
    () =>
      output && !output.error
        ? {
            columns: output.columns,
            rows: output.rows,
            rows_affected: output.rowsAffected,
            execution_time_ms: output.executionMs,
            notice: output.notice,
          }
        : null,
    [output],
  );
  const chart = useMemo<ResultChartBinding>(
    () => ({
      state: cell.chart ?? EMPTY_RESULT_CHART,
      onChange: (state) =>
        updateCell(cell.id, (c) => (c.type === "sql" ? { ...c, chart: state } : c)),
      sql: cell.source,
      name: cell.source.trim().split("\n")[0].slice(0, 60) || "Notebook-Abfrage",
      connectionId: connection?.id ?? null,
      database: null,
      kind: connection?.kind ?? null,
      sqlCapable: capabilitiesFor(connection?.kind).query_language === "sql",
    }),
    [cell.chart, cell.id, cell.source, connection?.id, connection?.kind, updateCell],
  );
  const total = output?.totalRows ?? output?.rows.length ?? 0;
  const status = output
    ? output.columns.length
      ? `${total.toLocaleString("de-DE")} Zeilen${total > output.rows.length ? ` (${output.rows.length.toLocaleString("de-DE")} gespeichert)` : ""}`
      : `${(output.rowsAffected ?? 0).toLocaleString("de-DE")} Zeilen betroffen`
    : null;
  const replace = (start: number, end: number, text: string) =>
    updateCell(cell.id, (c) =>
      c.type === "sql"
        ? { ...c, source: c.source.slice(0, start) + text + c.source.slice(end) }
        : c,
    );
  return (
    <div className="grid">
      <div className="flex h-9 items-center gap-2 border-b px-3">
        <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
          SQL
        </span>
        <NotebookConnectionSelect
          label="Verbindung der Zelle"
          inheritLabel="Notebook-Verbindung"
          value={cell.connectionId ?? null}
          onChange={(id) =>
            updateCell(cell.id, (c) => (c.type === "sql" ? { ...c, connectionId: id } : c))
          }
          className="w-auto max-w-48 border-transparent bg-transparent px-1.5 text-muted-foreground shadow-none hover:bg-muted dark:bg-transparent"
        />
        {connection?.readOnly && (
          <span className="text-[10px] text-muted-foreground">schreibgeschützt</span>
        )}
      </div>
      <NotebookSqlEditor
        value={cell.source}
        onChange={(source) => updateCell(cell.id, (c) => (c.type === "sql" ? { ...c, source } : c))}
        onRun={onRun}
        onRunAll={onRunAll}
      />
      {(running || output) && (
        <div className="flex h-8 items-center gap-1.5 border-t px-3 text-xs tabular-nums text-muted-foreground">
          {running ? (
            <>
              <Spinner className="size-3" /> Wird ausgeführt…
              <button
                type="button"
                className="ml-1 text-foreground underline-offset-2 hover:underline"
                onClick={onCancel}
              >
                Abbrechen
              </button>
            </>
          ) : output?.error ? (
            <>
              <CircleXIcon className="size-3.5 text-destructive" />
              <span>Fehler nach {output.executionMs.toLocaleString("de-DE")} ms</span>
            </>
          ) : (
            output && (
              <>
                <CircleCheckIcon className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                <span className="text-foreground/80">{status}</span>
                <span>·</span>
                <span>{output.executionMs.toLocaleString("de-DE")} ms</span>
                <span>·</span>
                <span title={new Date(output.ranAt).toLocaleString("de-DE")}>
                  {formatRelative(output.ranAt)}
                </span>
              </>
            )
          )}
        </div>
      )}
      {output?.error && !running && (
        <div className="border-t">
          <ResultError
            error={output.error}
            kind={connection?.kind}
            source={{ text: cell.source, base: 0 }}
            sql={cell.source}
            onReplace={replace}
          />
        </div>
      )}
      {result && result.columns.length > 0 && (
        <div className="h-72 overflow-hidden border-t">
          <QueryResultWorkbench
            result={result}
            isLoading={false}
            error={null}
            kind={connection?.kind}
            chart={chart}
          />
        </div>
      )}
      {result?.notice && !result.columns.length && (
        <p className="border-t px-3 py-2 text-xs text-muted-foreground">{result.notice}</p>
      )}
    </div>
  );
}
