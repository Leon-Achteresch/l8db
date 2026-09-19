import { type RefObject, useCallback, useMemo, useState } from "react";

import type { QueryEditorApi } from "@/features/query/query-editor-pane";
import type { ScriptRunEntry } from "@/features/query/script-result-list";
import type { ScriptRunMode } from "@/features/query/script-run-dialog";
import { runSqlScript } from "@/lib/script-runner";
import { useSettingsStore } from "@/lib/settings";
import { isTransactionalStatement, splitSqlStatements } from "@/lib/sql-statements";
import { getQueryTransaction } from "@/lib/transactions";

import { SCRIPT_MODE_NOTE } from "./constants";
import { withCreateNotice } from "./result-text";
import type { QueryViewCapabilities, QueryViewConnection } from "./types";
import type { QueryExecutionState } from "./use-query-execution-state";

interface UseScriptRunParams {
  sql: string;
  connection: QueryViewConnection;
  database: string | null;
  caps: QueryViewCapabilities;
  exec: QueryExecutionState;
  editorApiRef: RefObject<QueryEditorApi | null>;
  setEditorFocus: (focus: boolean) => void;
  collectOutput: () => Promise<void>;
}

export function useScriptRun({
  sql,
  connection,
  database,
  caps,
  exec,
  editorApiRef,
  setEditorFocus,
  collectOutput,
}: UseScriptRunParams) {
  const [scriptDialogOpen, setScriptDialogOpen] = useState(false);
  const [scriptMode, setScriptMode] = useState<ScriptRunMode>("autocommit");
  const {
    runningRef,
    setIsRunning,
    setScriptNote,
    setScriptActiveIndex,
    setStatementError,
    setStatementRange,
    setError,
    setErrorSource,
    setActiveJobId,
    setScriptEntries,
    setResultState,
  } = exec;

  const scriptSplit = useMemo(
    () => splitSqlStatements(sql, connection?.kind),
    [sql, connection?.kind],
  );

  const handleOpenScriptDialog = useCallback(() => {
    if (!connection) return;
    const existingTx = getQueryTransaction(connection.id, database);
    const hasDml = scriptSplit.statements.some((statement) =>
      isTransactionalStatement(statement.text, connection.kind),
    );
    if (existingTx) setScriptMode("existing-transaction");
    else if (hasDml && caps.transactions && useSettingsStore.getState().transactionsEnabled)
      setScriptMode("new-transaction");
    else setScriptMode("autocommit");
    setScriptDialogOpen(true);
  }, [connection, database, caps.transactions, scriptSplit]);

  const runScript = useCallback(
    async (mode: ScriptRunMode, stopOnError = true) => {
      if (!connection || runningRef.current) return;
      runningRef.current = true;
      setIsRunning(true);
      setScriptNote(SCRIPT_MODE_NOTE[mode]);
      setScriptActiveIndex(null);
      setStatementError(null);
      setStatementRange(null);
      setError(null);
      setEditorFocus(false);
      try {
        const outcome = await runSqlScript({
          connection,
          database,
          sql,
          mode,
          stopOnError,
          onJob: setActiveJobId,
          onProgress: setScriptEntries,
        });
        setScriptEntries(outcome.entries);
        setResultState(
          outcome.error
            ? null
            : withCreateNotice(outcome.lastResult, outcome.entries.at(-1)?.sql ?? sql),
        );
        setError(outcome.error);
        const failed = outcome.entries.find((entry) => entry.status === "error");
        setErrorSource(
          failed ? { text: sql.slice(failed.start, failed.end), base: failed.start } : null,
        );
        if (failed) {
          setStatementRange({ start: failed.start, end: failed.end });
          setScriptActiveIndex(failed.index);
        } else setScriptActiveIndex(outcome.entries.length - 1);
      } catch (failure) {
        setError(String(failure));
        setErrorSource(null);
      } finally {
        await collectOutput();
        runningRef.current = false;
        setIsRunning(false);
      }
    },
    [
      connection,
      database,
      sql,
      collectOutput,
      runningRef,
      setIsRunning,
      setScriptNote,
      setScriptActiveIndex,
      setStatementError,
      setStatementRange,
      setError,
      setErrorSource,
      setActiveJobId,
      setScriptEntries,
      setResultState,
      setEditorFocus,
    ],
  );

  const handleSelectScriptEntry = useCallback(
    (entry: ScriptRunEntry) => {
      setScriptActiveIndex(entry.index);
      if (!runningRef.current) {
        setResultState(withCreateNotice(entry.result ?? null, entry.sql));
        setError(entry.error);
        setErrorSource({ text: sql.slice(entry.start, entry.end), base: entry.start });
      }
      setStatementRange({ start: entry.start, end: entry.end });
      const before = sql.slice(0, entry.start).split("\n");
      editorApiRef.current?.revealMatch(before.length, before[before.length - 1].length + 1, 0);
    },
    [
      sql,
      runningRef,
      setScriptActiveIndex,
      setResultState,
      setError,
      setErrorSource,
      setStatementRange,
      editorApiRef,
    ],
  );

  return {
    scriptSplit,
    scriptDialogOpen,
    setScriptDialogOpen,
    scriptMode,
    handleOpenScriptDialog,
    runScript,
    handleSelectScriptEntry,
  };
}

export type ScriptRunState = ReturnType<typeof useScriptRun>;
