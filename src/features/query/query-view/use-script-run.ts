import { useQueryClient } from "@tanstack/react-query";
import { type RefObject, useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import type { QueryEditorApi } from "@/features/query/query-editor-pane";
import type { ScriptRunEntry } from "@/features/query/script-result-list";
import type { ScriptRunMode } from "@/features/query/script-run-dialog";
import { beginQueryEvent } from "@/lib/discovery/events";
import { invalidateAfterSql } from "@/lib/query-client";
import { beginQueryCompletion } from "@/lib/query-completion";
import { runSqlScript } from "@/lib/script-runner";
import { DEFAULT_SELECT_ROW_LIMIT } from "@/lib/select-row-limit";
import { enableOracleOutput } from "@/lib/server-output";
import { useSettingsStore } from "@/lib/settings";
import { locateText } from "@/lib/sql-diagnostics";
import { scriptPolicyIssue } from "@/lib/sql-safety";
import { isTransactionalStatement, splitSqlStatements } from "@/lib/sql-statements";
import { type AskVariables, substitutionSession } from "@/lib/sql-statements/sqlplus";
import { effectiveConnectionString } from "@/lib/ssh";
import { recordUserQueryOutcome } from "@/lib/telemetry";
import { getQueryTransaction } from "@/lib/transactions";
import { recordSuccessfulSql } from "@/lib/workbench/sql-states";

import { SCRIPT_MODE_NOTE } from "./constants";
import { withCreateNotice } from "./result-text";
import type { QueryViewCapabilities, QueryViewConnection } from "./types";
import type { QueryExecutionState } from "./use-query-execution-state";

interface UseScriptRunParams {
  sql: string;
  filePath: string | null;
  tabId: string;
  askVariables: AskVariables;
  connection: QueryViewConnection;
  database: string | null;
  caps: QueryViewCapabilities;
  exec: QueryExecutionState;
  editorApiRef: RefObject<QueryEditorApi | null>;
  setEditorFocus: (focus: boolean) => void;
  collectOutput: () => Promise<void>;
  cursorOffsetRef: RefObject<number>;
}

export function useScriptRun({
  sql,
  filePath,
  tabId,
  askVariables,
  connection,
  database,
  caps,
  exec,
  editorApiRef,
  setEditorFocus,
  collectOutput,
  cursorOffsetRef,
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
    setExecutedSql,
    setResultOrigin,
  } = exec;

  const scriptSplit = useMemo(
    () =>
      scriptDialogOpen
        ? splitSqlStatements(sql, connection?.kind, { slashRuns: connection?.kind === "oracle" })
        : { statements: [], commands: [], unterminated: false },
    [scriptDialogOpen, sql, connection?.kind],
  );

  const pickScriptMode = useCallback(
    (text: string): ScriptRunMode => {
      if (!connection) return "autocommit";
      if (getQueryTransaction(connection.id, database)) return "existing-transaction";
      const hasDml =
        connection.kind === "oracle" ||
        splitSqlStatements(text, connection.kind).statements.some((statement) =>
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
      const sqlplus = connection.kind === "oracle";
      setScriptNote(
        sqlplus && mode !== "autocommit"
          ? "SQL*Plus-Sitzung: Autocommit aus, COMMIT/ROLLBACK/EXIT im Skript wirken"
          : SCRIPT_MODE_NOTE[mode],
      );
      setScriptActiveIndex(null);
      setStatementError(null);
      setStatementRange(null);
      setError(null);
      setEditorFocus(false);
      const base = locateText(sql, text, cursorOffsetRef.current) ?? 0;
      const shift = (items: ScriptRunEntry[]) =>
        base ? items.map((e) => ({ ...e, start: e.start + base, end: e.end + base })) : items;
      const startedAt = performance.now();
      let executed = text;
      const finishNotification = beginQueryCompletion();
      const finishEvent = beginQueryEvent(text, connection.kind);
      try {
        await enableOracleOutput(
          connection.kind,
          effectiveConnectionString(connection),
          connection.id,
          database ?? undefined,
        );
        const outcome = await runSqlScript({
          connection,
          database,
          sql: text,
          mode,
          stopOnError,
          filePath,
          variables: substitutionSession(`${tabId}:${connection.id}`),
          askVariables,
          selectRowLimit: DEFAULT_SELECT_ROW_LIMIT,
          onJob: setActiveJobId,
          onProgress: (items) => setScriptEntries(shift(items)),
        });
        const entries = shift(outcome.entries);
        if (outcome.exit)
          setScriptNote(
            `EXIT ${outcome.exit.label} (Code ${outcome.exit.code}) mit ${outcome.exit.action}`,
          );
        recordUserQueryOutcome(connection.kind, outcome.error, performance.now() - startedAt);
        finishEvent(!outcome.error);
        setScriptEntries(entries);
        if (!outcome.error) {
          void recordSuccessfulSql(connection.id, database, tabId, text).catch((error) =>
            toast.error("Erfolgreicher SQL-Stand konnte nicht gespeichert werden", {
              description: String(error),
            }),
          );
          const successfulSql = entries.at(-1)?.sql ?? text;
          setResultState(withCreateNotice(outcome.lastResult, successfulSql));
          setExecutedSql(successfulSql);
          setResultOrigin({
            sql: successfulSql,
            at: Date.now(),
            connectionId: connection.id,
            database,
          });
        }
        finishNotification(
          outcome.error && /abgebrochen|cancel/i.test(outcome.error)
            ? "cancelled"
            : outcome.error
              ? "error"
              : "success",
        );
        setError(outcome.error);
        executed = entries.map((entry) => entry.sql).join("\n");
        const failed = entries.find((entry) => entry.status === "error");
        setErrorSource(
          failed && !failed.source
            ? { text: sql.slice(failed.start, failed.end), base: failed.start }
            : null,
        );
        if (failed) {
          setStatementRange({ start: failed.start, end: failed.end });
          setScriptActiveIndex(failed.index);
        } else setScriptActiveIndex(entries.length - 1);
      } catch (failure) {
        recordUserQueryOutcome(connection.kind, failure, performance.now() - startedAt);
        finishEvent(false);
        finishNotification(
          /abgebrochen|cancelled|canceled/i.test(String(failure)) ? "cancelled" : "error",
        );
        setError(String(failure));
        setErrorSource(null);
      } finally {
        runningRef.current = false;
        setIsRunning(false);
        await collectOutput();
        if (connection) await invalidateAfterSql(queryClient, connection.id, database, executed);
      }
    },
    [
      connection,
      queryClient,
      database,
      sql,
      filePath,
      tabId,
      askVariables,
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
      setExecutedSql,
      setResultOrigin,
      setEditorFocus,
      cursorOffsetRef,
    ],
  );

  const handleSelectScriptEntry = useCallback(
    (entry: ScriptRunEntry) => {
      setScriptActiveIndex(entry.index);
      if (!runningRef.current) {
        if (!entry.error) {
          setResultState(withCreateNotice(entry.result ?? null, entry.sql));
          setExecutedSql(entry.sql);
          if (connection)
            setResultOrigin({
              sql: entry.sql,
              at: Date.now(),
              connectionId: connection.id,
              database,
            });
        }
        setError(entry.error);
        setErrorSource(
          entry.source ? null : { text: sql.slice(entry.start, entry.end), base: entry.start },
        );
      }
      setStatementRange({ start: entry.start, end: entry.end });
      const before = sql.slice(0, entry.start).split("\n");
      editorApiRef.current?.revealMatch(before.length, before[before.length - 1].length + 1, 0);
    },
    [
      sql,
      runningRef,
      setScriptActiveIndex,
      connection,
      database,
      setExecutedSql,
      setResultOrigin,
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
