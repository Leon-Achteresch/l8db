import { EyeIcon } from "lucide-react";
import { type ReactNode, useState } from "react";

import { Collapse } from "@/components/motion/collapse";
import { Button } from "@/components/ui/button";
import { ResultError } from "@/features/query/query-result-table/result-error";
import { QueryResultView } from "@/features/query/query-result-view/query-result-view";
import { QueryResultWorkbench } from "@/features/query/query-result-workbench";
import type { ResultChartBinding } from "@/features/query/result-chart/types";
import type { DatabaseKind, TableInfo } from "@/lib/db";
import type { SqlMarker } from "@/lib/sql-diagnostics";

import { ResultHeader } from "./result-header";
import type { QueryExecutionState } from "./use-query-execution-state";

interface QueryResultsContentProps {
  exec: QueryExecutionState;
  kind: DatabaseKind | undefined;
  statusText: string | null;
  actions: ReactNode;
  onRevealError: (marker: SqlMarker) => void;
  onReplaceSql?: (start: number, end: number, text: string) => void;
  onFixWithAi?: () => void;
  sql?: string;
  names?: { columns: string[]; tables: string[] };
  chart?: ResultChartBinding;
  tables: TableInfo[];
  maximized: boolean;
  onToggleMaximized: () => void;
}

export function QueryResultsContent({
  exec,
  kind,
  statusText,
  actions,
  onRevealError,
  onReplaceSql,
  onFixWithAi,
  sql,
  names,
  chart,
  tables,
  maximized,
  onToggleMaximized,
}: QueryResultsContentProps) {
  const { result, isRunning, error, statementError, viewSource, scriptEntries } = exec;
  const [classic, setClassic] = useState(false);
  const viewable =
    viewSource !== null && !scriptEntries && !error && result !== null && result.columns.length > 0;
  const showView = viewable && !classic && !isRunning;
  const showResultHeader = !result || isRunning || Boolean(error) || result.columns.length === 0;
  return (
    <>
      {showResultHeader && (
        <ResultHeader
          isRunning={isRunning}
          error={error}
          result={result}
          statusText={statusText}
          actions={actions}
        />
      )}

      <Collapse open={Boolean(statementError)} className="shrink-0">
        {statementError && (
          <p className="border-b px-3 py-1.5 text-xs text-amber-600 dark:text-amber-400">
            {statementError}
          </p>
        )}
      </Collapse>

      <div className="min-h-0 flex-1">
        {error && !isRunning ? (
          <ResultError
            error={error}
            kind={kind}
            source={exec.editorError}
            sql={sql}
            columns={names?.columns}
            tables={names?.tables}
            onReveal={onRevealError}
            onReplace={onReplaceSql}
            onFixWithAi={onFixWithAi}
          />
        ) : showView && viewSource && result ? (
          <QueryResultView
            key={viewSource.runId}
            text={viewSource.text}
            runId={viewSource.runId}
            result={result}
            tables={tables}
            statusText={statusText}
            actions={actions}
            maximized={maximized}
            onToggleMaximized={onToggleMaximized}
            onShowClassic={() => setClassic(true)}
          />
        ) : (
          <QueryResultWorkbench
            result={result}
            isLoading={isRunning}
            error={error}
            kind={kind}
            statusText={statusText}
            actions={
              viewable && !isRunning ? (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1.5 px-2 text-xs"
                    title="Ergebnis als temporäre View anzeigen"
                    onClick={() => setClassic(false)}
                  >
                    <EyeIcon className="size-3.5" />
                    Als View
                  </Button>
                  {actions}
                </>
              ) : (
                actions
              )
            }
            chart={chart}
          />
        )}
      </div>
    </>
  );
}
