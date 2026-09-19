import type { ReactNode } from "react";

import { Collapse } from "@/components/motion/collapse";
import { QueryResultWorkbench } from "@/features/query/query-result-workbench";
import type { DatabaseKind } from "@/lib/db";

import { ResultHeader } from "./result-header";
import type { QueryExecutionState } from "./use-query-execution-state";

interface QueryResultsContentProps {
  exec: QueryExecutionState;
  kind: DatabaseKind | undefined;
  statusText: string | null;
  actions: ReactNode;
}

export function QueryResultsContent({ exec, kind, statusText, actions }: QueryResultsContentProps) {
  const { result, isRunning, error, statementError } = exec;
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
        <QueryResultWorkbench
          result={result}
          isLoading={isRunning}
          error={error}
          kind={kind}
          statusText={statusText}
          actions={actions}
        />
      </div>
    </>
  );
}
