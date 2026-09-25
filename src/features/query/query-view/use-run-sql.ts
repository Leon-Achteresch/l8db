import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";

import {
  type BindParamRef,
  type BindParamValue,
  buildParameterizedQuery,
  detectBindParams,
  inlineBindValues,
  type ParameterizedQuery,
} from "@/lib/bind-params";
import { confirmSqlExecution, type QueryResult } from "@/lib/db";
import { invalidateTableReads } from "@/lib/query-client";
import { useQueryHistoryStore } from "@/lib/query-history";
import { locateText } from "@/lib/sql-diagnostics";
import { effectiveConnectionString } from "@/lib/ssh";
import { useTableTabs } from "@/lib/table-tabs";

import { executeSqlWithTransactions } from "./execute-sql";
import { rowCountOf, withCreateNotice } from "./result-text";
import type { QueryViewCapabilities, QueryViewConnection } from "./types";
import type { EditorCursorState } from "./use-editor-cursor-state";
import type { QueryExecutionState } from "./use-query-execution-state";

interface UseRunSqlParams {
  tabId: string;
  sql: string;
  connection: QueryViewConnection;
  database: string | null;
  caps: QueryViewCapabilities;
  exec: QueryExecutionState;
  cursor: EditorCursorState;
  markQueryTabExecuted: (tabId: string, sql: string) => void;
  setEditorFocus: (focus: boolean) => void;
  collectOutput: () => Promise<void>;
}

export function useRunSql({
  tabId,
  sql: tabSql,
  connection,
  database,
  caps,
  exec,
  cursor,
  markQueryTabExecuted,
  setEditorFocus,
  collectOutput,
}: UseRunSqlParams) {
  const queryClient = useQueryClient();
  const recordHistory = useQueryHistoryStore((state) => state.record);
  const [bindDialogOpen, setBindDialogOpen] = useState(false);
  const [bindRefs, setBindRefs] = useState<BindParamRef[]>([]);
  const [bindPendingSql, setBindPendingSql] = useState<string | null>(null);
  const [bindValues, setBindValues] = useState<Record<string, BindParamValue>>({});
  const {
    runningRef,
    setIsRunning,
    setActiveJobId,
    setScriptEntries,
    setScriptActiveIndex,
    setError,
    setErrorSource,
    setResultState,
    setExecutedSql,
  } = exec;
  const { editorSqlRef, cursorOffsetRef } = cursor;

  const runSql = useCallback(
    async (text: string, bound?: ParameterizedQuery, skipBind = false) => {
      const sql = text;
      if (!connection || !sql.trim() || runningRef.current) return;
      if (
        !bound &&
        !skipBind &&
        caps.query_language !== "redis" &&
        caps.query_language !== "json"
      ) {
        const refs = detectBindParams(sql).filter((ref) => !/^(new|old)$/i.test(ref.name));
        if (refs.length > 0) {
          setBindValues((previous) => {
            const next: Record<string, BindParamValue> = {};
            for (const ref of refs) {
              next[ref.name] = previous[ref.name] ?? { type: "text", value: "" };
            }
            return next;
          });
          setBindRefs(refs);
          setBindPendingSql(sql);
          setBindDialogOpen(true);
          return;
        }
      }
      setEditorFocus(false);
      const currentTab = useTableTabs
        .getState()
        .tabs.find((tab) => tab.kind === "query" && tab.id === tabId);
      if (currentTab?.kind === "query" && currentTab.sql === sql) {
        markQueryTabExecuted(tabId, sql);
      }
      runningRef.current = true;
      setIsRunning(true);
      setScriptEntries(null);
      setScriptActiveIndex(null);
      setError(null);
      const startedAt = performance.now();
      const finishHistory = (outcome: { rowCount: number | null; error: string | null }) => {
        recordHistory({
          connectionId: connection.id,
          database: database ?? null,
          sql,
          durationMs: Math.round(performance.now() - startedAt),
          rowCount: outcome.rowCount,
          error: outcome.error ? outcome.error.slice(0, 500) : null,
        });
      };
      const setResult = (res: QueryResult | null) => setResultState(withCreateNotice(res, sql));
      let executionStarted = false;
      try {
        await confirmSqlExecution(
          connection.kind,
          effectiveConnectionString(connection),
          sql,
          database ?? undefined,
        );
        executionStarted = true;
        const res = await executeSqlWithTransactions({
          connection,
          database,
          sql,
          bound,
          transactionsCapable: caps.transactions,
          onJob: setActiveJobId,
        });
        setExecutedSql(sql);
        setResult(res);
        finishHistory({ rowCount: rowCountOf(res), error: null });
      } catch (err) {
        const message = String(err);
        setError(message);
        const base = locateText(editorSqlRef.current, sql, cursorOffsetRef.current);
        setErrorSource(base === null ? null : { text: sql, base });
        setResult(null);
        finishHistory({ rowCount: null, error: message });
      } finally {
        if (executionStarted) await invalidateTableReads(queryClient, connection.id, database);
        await collectOutput();
        runningRef.current = false;
        setIsRunning(false);
      }
    },
    [
      connection,
      database,
      markQueryTabExecuted,
      recordHistory,
      caps.transactions,
      caps.query_language,
      queryClient,
      collectOutput,
      tabId,
      runningRef,
      setIsRunning,
      setActiveJobId,
      setScriptEntries,
      setScriptActiveIndex,
      setError,
      setErrorSource,
      setResultState,
      setExecutedSql,
      editorSqlRef,
      cursorOffsetRef,
      setEditorFocus,
    ],
  );

  const autoRun = useTableTabs((state) => {
    const tab = state.tabs.find((t) => t.kind === "query" && t.id === tabId);
    return tab?.kind === "query" ? Boolean(tab.autoRun) : false;
  });
  useEffect(() => {
    if (!autoRun || !connection) return;
    useTableTabs.setState((state) => ({
      tabs: state.tabs.map((t) =>
        t.kind === "query" && t.id === tabId ? { ...t, autoRun: undefined } : t,
      ),
    }));
    void runSql(tabSql);
  }, [autoRun, connection, runSql, tabSql, tabId]);

  const handleBindConfirm = useCallback(() => {
    const pending = bindPendingSql;
    if (!pending) return;
    setBindDialogOpen(false);
    setBindPendingSql(null);
    if (caps.bind_parameters) {
      void runSql(pending, buildParameterizedQuery(pending, bindValues, connection?.kind));
    } else {
      markQueryTabExecuted(tabId, pending);
      void runSql(inlineBindValues(pending, bindValues), undefined, true);
    }
  }, [
    bindPendingSql,
    bindValues,
    markQueryTabExecuted,
    runSql,
    caps.bind_parameters,
    tabId,
    connection?.kind,
  ]);

  return {
    runSql,
    bind: {
      open: bindDialogOpen,
      onOpenChange: (open: boolean) => {
        setBindDialogOpen(open);
        if (!open) setBindPendingSql(null);
      },
      refs: bindRefs,
      values: bindValues,
      onValuesChange: setBindValues,
      onConfirm: handleBindConfirm,
    },
  };
}
