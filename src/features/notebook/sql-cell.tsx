import { ListEndIcon, PlayIcon, SquareIcon } from "lucide-react";
import { useMemo } from "react";
import { IconButton } from "@/components/icon-button";
import { Spinner } from "@/components/ui/spinner";
import { QueryResultWorkbench } from "@/features/query/query-result-workbench";
import type { ResultChartBinding } from "@/features/query/result-chart/types";
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
  onRunFrom,
  onCancel,
}: {
  cell: SqlNotebookCell;
  connectionId: string | null;
  output: NotebookOutput | undefined;
  running: boolean;
  onRun: () => void;
  onRunFrom: () => void;
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
    ? output.error
      ? "Fehler"
      : output.columns.length
        ? `${total.toLocaleString("de-DE")} Zeilen${total > (output.rows.length ?? 0) ? ` (${output.rows.length} gespeichert)` : ""}`
        : `${output.rowsAffected ?? 0} Zeilen betroffen`
    : null;
  return (
    <div className="grid gap-2">
      <div className="flex items-center gap-1">
        {running ? (
          <IconButton variant="ghost" size="icon-xs" aria-label="Abbrechen" onClick={onCancel}>
            <SquareIcon />
          </IconButton>
        ) : (
          <IconButton variant="ghost" size="icon-xs" aria-label="Zelle ausführen" onClick={onRun}>
            <PlayIcon />
          </IconButton>
        )}
        <IconButton
          variant="ghost"
          size="icon-xs"
          aria-label="Ab hier ausführen"
          disabled={running}
          onClick={onRunFrom}
        >
          <ListEndIcon />
        </IconButton>
        <NotebookConnectionSelect
          label="Verbindung der Zelle"
          inheritLabel="Notebook-Verbindung"
          value={cell.connectionId ?? null}
          onChange={(id) =>
            updateCell(cell.id, (c) => (c.type === "sql" ? { ...c, connectionId: id } : c))
          }
          className="ml-1 w-44"
        />
        {connection?.readOnly && (
          <span className="text-[10px] text-muted-foreground">schreibgeschützt</span>
        )}
        <span className="ml-auto flex items-center gap-2 text-[11px] tabular-nums text-muted-foreground">
          {running && <Spinner className="size-3" />}
          {!running && status && (
            <>
              <span className={output?.error ? "text-destructive" : undefined}>{status}</span>
              <span>{output?.executionMs} ms</span>
            </>
          )}
        </span>
      </div>
      <NotebookSqlEditor
        value={cell.source}
        onChange={(source) => updateCell(cell.id, (c) => (c.type === "sql" ? { ...c, source } : c))}
        onRun={onRun}
      />
      {output?.error && (
        <pre
          role="alert"
          className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
        >
          {output.error}
        </pre>
      )}
      {result && result.columns.length > 0 && (
        <div className="h-80 overflow-hidden rounded-md border">
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
        <p className="text-xs text-muted-foreground">{result.notice}</p>
      )}
    </div>
  );
}
