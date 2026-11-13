import { EyeIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Collapse } from "@/components/motion/collapse";
import { Button } from "@/components/ui/button";
import { ResultError } from "@/features/query/query-result-table/result-error";
import { QueryResultView } from "@/features/query/query-result-view/query-result-view";
import { QueryResultWorkbench } from "@/features/query/query-result-workbench";
import type { ResultChartBinding } from "@/features/query/result-chart/types";
import { ResultCompareView } from "@/features/query/result-compare/result-compare-view";
import { ResultSnapshotsButton } from "@/features/query/result-snapshots-button";
import type { DatabaseKind, TableInfo } from "@/lib/db";
import type { SqlMarker } from "@/lib/sql-diagnostics";
import { tabStateKey, useTabState } from "@/lib/tab-state";
import { PreviousResultNotice } from "./previous-result-notice";
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
  compareOpen: boolean;
  connectionId: string | null;
  database: string | null;
  outputTabs?: ReactNode;
  outputPanel?: ReactNode;
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
  compareOpen,
  connectionId,
  database,
  outputTabs,
  outputPanel,
}: QueryResultsContentProps) {
  const { result, isRunning, error, statementError, viewSource, scriptEntries } = exec;
  const [classic, setClassic] = useTabState(tabStateKey(exec.scope, "classic"), false);
  const [snapshotCompare, setSnapshotCompare] = useTabState<string | null>(
    tabStateKey(exec.scope, "snapshotCompare"),
    null,
  );
  const viewable =
    viewSource !== null && !scriptEntries && !error && result !== null && result.columns.length > 0;
  const showView = viewable && !classic && !isRunning;
  const showCompare =
    (compareOpen || snapshotCompare) &&
    !isRunning &&
    !error &&
    result !== null &&
    result.columns.length > 0;
  const snapshotRun =
    !isRunning &&
    !error &&
    result?.columns.length &&
    exec.resultOrigin?.connectionId === connectionId &&
    exec.resultOrigin.database === database
      ? { ...exec.resultOrigin, result }
      : null;
  const resultActions = (
    <>
      <ResultSnapshotsButton
        run={snapshotRun}
        connectionId={connectionId}
        database={database}
        onCompare={(baseline, name) => {
          exec.setRuns({ baseline, latest: snapshotRun, pinned: true });
          setClassic(true);
          setSnapshotCompare(name);
        }}
      />
      {actions}
    </>
  );
  const previousResult = Boolean(error && result?.columns.length);
  const showResultHeader = !result || isRunning || result.columns.length === 0;
  if (outputPanel) return outputPanel;
  return (
    <>
      <div className="shrink-0 bg-muted/20 px-2 empty:hidden">{outputTabs}</div>
      {showResultHeader && (
        <ResultHeader
          isRunning={isRunning}
          error={error}
          result={result}
          statusText={statusText}
          actions={resultActions}
        />
      )}

      <Collapse open={Boolean(statementError)} className="shrink-0">
        {statementError && (
          <p className="border-b px-3 py-1.5 text-xs text-amber-600 dark:text-amber-400">
            {statementError}
          </p>
        )}
      </Collapse>

      {error && !isRunning && previousResult && (
        <div className="max-h-48 shrink-0 overflow-auto border-b">
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
        </div>
      )}
      {previousResult && !isRunning && (
        <PreviousResultNotice sql={exec.executedSql} at={exec.resultOrigin?.at ?? null} />
      )}
      {snapshotCompare && !isRunning && !error && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 shrink-0 self-start text-xs"
          aria-label="Ergebnisstand-Vergleich schließen"
          onClick={() => setSnapshotCompare(null)}
        >
          Vergleich „{snapshotCompare}“ schließen
        </Button>
      )}
      <div className="min-h-0 flex-1">
        {error && !isRunning && !previousResult ? (
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
        ) : showCompare ? (
          <ResultCompareView
            scope={exec.scope}
            result={result}
            runs={exec.runs}
            onRunsChange={exec.setRuns}
            connectionId={connectionId}
            database={database}
            actions={resultActions}
            maximized={maximized}
            onToggleMaximized={onToggleMaximized}
          />
        ) : showView && viewSource && result ? (
          <QueryResultView
            key={viewSource.runId}
            text={viewSource.text}
            runId={viewSource.runId}
            result={result}
            tables={tables}
            statusText={statusText}
            actions={resultActions}
            maximized={maximized}
            onToggleMaximized={onToggleMaximized}
            onShowClassic={() => setClassic(true)}
          />
        ) : (
          <QueryResultWorkbench
            key={exec.scope}
            stateKey={tabStateKey(exec.scope, "resultView")}
            result={result}
            isLoading={isRunning}
            error={previousResult ? null : error}
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
                  {resultActions}
                </>
              ) : (
                resultActions
              )
            }
            chart={previousResult ? undefined : chart}
            previous={previousResult}
          />
        )}
      </div>
    </>
  );
}
