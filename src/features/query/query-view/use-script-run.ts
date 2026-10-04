import { useQueryClient } from "@tanstack/react-query";
import { type RefObject, useCallback, useMemo, useState } from "react";

import type { QueryEditorApi } from "@/features/query/query-editor-pane";
import type { ScriptRunEntry } from "@/features/query/script-result-list";
import type { ScriptRunMode } from "@/features/query/script-run-dialog";
import { invalidateTableReads } from "@/lib/query-client";
import { runSqlScript } from "@/lib/script-runner";
import { DEFAULT_SELECT_ROW_LIMIT } from "@/lib/select-row-limit";
import { useSettingsStore } from "@/lib/settings";
import { scriptPolicyIssue } from "@/lib/sql-safety";
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
  const queryClient = useQueryClient();
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

  const pickScriptMode = useCallback(
    (text: string): ScriptRunMode => {
      if (!connection) return "autocommit";
      if (getQueryTransaction(connection.id, database)) return "existing-transaction";
      const hasDml = splitSqlStatements(text, connection.kind).statements.some((statement) =>
        isTransactionalStatement(statement.text, connection.kind),
      );
      if (
        hasDml &&
        caps.transactions &&
        useSettingsStore.getState().transactionsEnabled &&
        !scriptPolicyIssue(text, connection.kind, true)
      )
        return "new-transaction";
      return "autocommit";
    },
    [connection, database, caps.transactions],
  );

  const handleOpenScriptDialog = useCallback(() => {
    if (!connection) return;
    setScriptMode(pickScriptMode(sql));
    setScriptDialogOpen(true);
  }, [connection, sql, pickScriptMode]);

  const runScript = useCallback(
    async (mode: ScriptRunMode, stopOnError = true, text = sql) => {
      if (!connection || runningRef.current) return;
      runningRef.current = true;
      setIsRunning(true);
      setScriptNote(SCRIPT_MODE_NOTE[mode]);
      setScriptActiveIndex(null);
      setStatementError(null);
      setStatementRange(null);
      setError(null);
      setEditorFocus(false);
      const base = Math.max(0, sql.indexOf(text));
      const shift = (items: ScriptRunEntry[]) =>
        base ? items.map((e) => ({ ...e, start: e.start + base, end: e.end + base })) : items;
      try {
        const outcome = await runSqlScript({
          connection,
          database,
          sql: text,
          mode,
          stopOnError,
          selectRowLimit: DEFAULT_SELECT_ROW_LIMIT,
          onJob: setActiveJobId,
          onProgress: (items) => setScriptEntries(shift(items)),
        });
        const entries = shift(outcome.entries);
        setScriptEntries(entries);
        setResultState(
          outcome.error ? null : withCreateNotice(outcome.lastResult, entries.at(-1)?.sql ?? text),
        );
        setError(outcome.error);
        const failed = entries.find((entry) => entry.status === "error");
        setErrorSource(
          failed ? { text: sql.slice(failed.start, failed.end), base: failed.start } : null,
        );
        if (failed) {
          setStatementRange({ start: failed.start, end: failed.end });
          setScriptActiveIndex(failed.index);
        } else setScriptActiveIndex(entries.length - 1);
      } catch (failure) {
        setError(String(failure));
        setErrorSource(null);
      } finally {
        if (connection) await invalidateTableReads(queryClient, connection.id, database);
        await collectOutput();
        runningRef.current = false;
        setIsRunning(false);
      }
    },
    [
      connection,
      queryClient,
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

  const runScriptFor = useCallback(
    (text: string) => runScript(pickScriptMode(text), true, text),
    [runScript, pickScriptMode],
  );

  return {
    scriptSplit,
    scriptDialogOpen,
    setScriptDialogOpen,
    scriptMode,
    handleOpenScriptDialog,
    runScript,
    runScriptFor,
    handleSelectScriptEntry,
  };
}

export type ScriptRunState = ReturnType<typeof useScriptRun>;
