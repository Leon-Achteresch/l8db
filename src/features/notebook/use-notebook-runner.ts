import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef } from "react";
import { executeSqlWithTransactions } from "@/features/query/query-view/execute-sql";
import { useActiveConnection } from "@/lib/connections";
import { confirmSqlExecution } from "@/lib/db";
import { useActiveDatabase } from "@/lib/db-selection";
import { notebookVariables, prepareCellSql, useNotebookStore } from "@/lib/notebook";
import { capabilitiesFor } from "@/lib/providers";
import { invalidateTableReads } from "@/lib/query-client";
import { useQueryHistoryStore } from "@/lib/query-history";
import { prepareConnection } from "@/lib/schema-compare/store";
import { effectiveConnectionString } from "@/lib/ssh";
import { cancelTask } from "@/lib/tasks";

export function useNotebookRunner() {
  const queryClient = useQueryClient();
  const active = useActiveConnection();
  const activeDatabase = useActiveDatabase();
  const cancelled = useRef(false);

  const runCell = useCallback(
    async (id: string): Promise<boolean> => {
      const store = useNotebookStore.getState();
      const index = store.doc.cells.findIndex((c) => c.id === id);
      const cell = store.doc.cells[index];
      if (cell?.type !== "sql" || store.running[id]) return true;
      if (!cell.source.trim()) return true;
      const connectionId = cell.connectionId ?? store.doc.connectionId ?? active?.id ?? null;
      const startedAt = performance.now();
      const fail = (error: unknown) =>
        store.setOutput(id, {
          columns: [],
          rows: [],
          rowsAffected: null,
          executionMs: Math.round(performance.now() - startedAt),
          error: error instanceof Error ? error.message : String(error),
          ranAt: Date.now(),
        });
      if (!connectionId) {
        fail("Keine Verbindung ausgewählt.");
        return false;
      }
      store.setRunning(id, true);
      let target: { id: string; database: string | null } | null = null;
      let sql = cell.source;
      try {
        const connection =
          active && connectionId === active.id ? active : await prepareConnection(connectionId);
        const caps = capabilitiesFor(connection.kind);
        const database = connection.id === active?.id ? activeDatabase : null;
        target = { id: connection.id, database };
        const prepared = prepareCellSql(
          cell.source,
          notebookVariables(useNotebookStore.getState().doc.cells, index),
          {
            bindParams: caps.bind_parameters,
            sqlLanguage: caps.query_language === "sql",
            kind: connection.kind,
          },
        );
        sql = prepared.sql;
        await confirmSqlExecution(
          connection.kind,
          effectiveConnectionString(connection),
          prepared.sql,
          database ?? undefined,
        );
        const result = await executeSqlWithTransactions({
          connection,
          database,
          sql: prepared.sql,
          bound: prepared.bound,
          transactionsCapable: caps.transactions,
          onJob: (job) => useNotebookStore.getState().setRunning(id, job),
        });
        store.setOutput(id, {
          columns: result.columns,
          rows: result.rows,
          rowsAffected: result.rows_affected,
          executionMs: result.execution_time_ms,
          notice: result.notice,
          ranAt: Date.now(),
        });
        useQueryHistoryStore.getState().record({
          connectionId: connection.id,
          database,
          sql,
          durationMs: Math.round(performance.now() - startedAt),
          rowCount: result.columns.length ? result.rows.length : result.rows_affected,
          error: null,
        });
        return true;
      } catch (error) {
        fail(error);
        if (target)
          useQueryHistoryStore.getState().record({
            connectionId: target.id,
            database: target.database,
            sql,
            durationMs: Math.round(performance.now() - startedAt),
            rowCount: null,
            error: String(error).slice(0, 500),
          });
        return false;
      } finally {
        useNotebookStore.getState().setRunning(id, null);
        if (target) await invalidateTableReads(queryClient, target.id, target.database);
      }
    },
    [active, activeDatabase, queryClient],
  );

  const runMany = useCallback(
    async (ids: string[]) => {
      cancelled.current = false;
      for (const id of ids) {
        if (cancelled.current) break;
        if (!(await runCell(id))) break;
      }
    },
    [runCell],
  );

  const sqlIds = (from = 0) =>
    useNotebookStore
      .getState()
      .doc.cells.slice(from)
      .filter((c) => c.type === "sql")
      .map((c) => c.id);

  return {
    runCell: (id: string) => {
      cancelled.current = false;
      return runCell(id);
    },
    runAll: () => runMany(sqlIds()),
    runFrom: (id: string) =>
      runMany(sqlIds(useNotebookStore.getState().doc.cells.findIndex((c) => c.id === id))),
    cancel: () => {
      cancelled.current = true;
      for (const job of Object.values(useNotebookStore.getState().running))
        if (typeof job === "string") void cancelTask(job);
    },
  };
}
