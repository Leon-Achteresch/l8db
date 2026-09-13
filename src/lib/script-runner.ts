import type { ScriptRunEntry } from "@/features/query/script-result-list";
import type { ScriptRunMode } from "@/features/query/script-run-dialog";
import type { SavedConnection } from "@/lib/connections";
import {
  cancelExecution,
  confirmSqlExecution,
  executeInTransaction,
  executeQuery,
  type QueryResult,
} from "@/lib/db";
import { ensureManagedTransaction, runManagedOperation } from "@/lib/managed-transactions";
import { supports } from "@/lib/providers";
import { useQueryHistoryStore } from "@/lib/query-history";
import { scriptPolicyIssue } from "@/lib/sql-safety";
import { isTransactionalStatement, splitSqlStatements } from "@/lib/sql-statements";
import { effectiveConnectionString } from "@/lib/ssh";
import { finishTask, startTask, updateTask } from "@/lib/tasks";
import { getQueryTransaction, useTransactionStore } from "@/lib/transactions";

export interface ScriptRequest {
  connection: SavedConnection;
  database: string | null;
  sql: string;
  mode: ScriptRunMode;
  stopOnError?: boolean;
  title?: string;
  onJob?: (id: string) => void;
  onProgress?: (entries: ScriptRunEntry[]) => void;
}

export interface ScriptOutcome {
  entries: ScriptRunEntry[];
  lastResult: QueryResult | null;
  error: string | null;
  txId: string | null;
}

export async function runSqlScript(request: ScriptRequest): Promise<ScriptOutcome> {
  const { connection, database, mode } = request;
  const url = effectiveConnectionString(connection);
  const split = splitSqlStatements(request.sql, connection.kind);
  if (split.unterminated)
    throw new Error(
      "Nicht abgeschlossenes SQL-Literal oder Kommentar. Das Skript wurde nicht gestartet.",
    );
  if (!split.statements.length)
    throw new Error("Das Skript enthält keine ausführbaren Statements.");
  const policyIssue = scriptPolicyIssue(request.sql, connection.kind, mode !== "autocommit");
  if (policyIssue) throw new Error(policyIssue);
  await confirmSqlExecution(connection.kind, url, request.sql, database ?? undefined);
  const existing = getQueryTransaction(connection.id, database);
  if (existing && mode !== "existing-transaction")
    throw new Error(
      "Für dieses Ziel besteht bereits eine Transaktion. Bitte diese verwenden oder zuerst abschließen.",
    );
  if (!existing && mode === "existing-transaction")
    throw new Error("Die ausgewählte Transaktion ist nicht mehr offen.");
  if (mode !== "autocommit" && !supports(connection, "transactions"))
    throw new Error("Dieser Provider unterstützt keine Skript-Transaktionen.");

  const entries: ScriptRunEntry[] = split.statements.map((statement, index) => ({
    index,
    sql: statement.text,
    start: statement.start,
    end: statement.end,
    status: "pending",
    durationMs: null,
    rowCount: null,
    rowsAffected: null,
    error: null,
  }));
  let stopped = false;
  let currentJob: string | null = null;
  const jobId = startTask(
    {
      title: request.title ?? "SQL-Skript",
      connectionId: connection.id,
      connectionName: connection.name,
      database,
      total: entries.length,
    },
    async () => {
      stopped = true;
      if (currentJob && supports(connection, "query_cancel")) return cancelExecution(currentJob);
      updateTask(jobId, {
        detail: "Das aktuelle Statement wird zu Ende geführt; danach stoppt das Skript.",
      });
      return true;
    },
  );
  request.onJob?.(jobId);
  let txId = existing?.txId ?? null;
  let error: string | null = null;
  let lastResult: QueryResult | null = null;
  try {
    if (mode === "new-transaction") {
      txId = (await ensureManagedTransaction(connection, database, { type: "query" })).txId;
      useTransactionStore.getState().setPanelOpen(true);
    }
    const publish = () => request.onProgress?.(entries.map((entry) => ({ ...entry })));
    for (const entry of entries) {
      if (stopped || (error && (request.stopOnError !== false || txId))) {
        entry.status = "skipped";
        publish();
        continue;
      }
      entry.status = "running";
      publish();
      const started = performance.now();
      const options = {
        confirmed: true,
        track: false,
        onJob: (id: string) => {
          currentJob = id;
        },
      };
      try {
        const result = txId
          ? await runManagedOperation(txId, () => executeInTransaction(txId!, entry.sql, options))
          : await executeQuery(connection.kind, url, entry.sql, database ?? undefined, options);
        entry.result = result;
        entry.status = "success";
        entry.rowCount = result.columns.length ? result.rows.length : null;
        entry.rowsAffected = result.rows_affected == null ? null : Number(result.rows_affected);
        lastResult = result;
        if (txId && isTransactionalStatement(entry.sql, connection.kind)) {
          useTransactionStore.getState().addChange(txId, {
            id: crypto.randomUUID(),
            type: "query",
            timestamp: Date.now(),
            sql: entry.sql,
            rowsAffected: result.rows_affected,
          });
        }
      } catch (failure) {
        entry.status = "error";
        entry.error = failure instanceof Error ? failure.message : String(failure);
        error = entry.error;
      } finally {
        currentJob = null;
        entry.durationMs = Math.round(performance.now() - started);
        useQueryHistoryStore.getState().record({
          connectionId: connection.id,
          database,
          sql: entry.sql,
          durationMs: entry.durationMs,
          rowCount: entry.rowCount ?? entry.rowsAffected,
          error: entry.error,
        });
        updateTask(jobId, {
          progress: entries.filter((item) => item.status === "success" || item.status === "error")
            .length,
          detail: txId
            ? "Ausgeführt in einer verwalteten Transaktion. Commit oder Rollback erfolgt separat im Transaktionspanel."
            : "Autocommit: Erfolgreiche Statements wurden einzeln übernommen.",
        });
        publish();
      }
    }
    if (stopped && entries.some((entry) => entry.status === "skipped") && !error)
      error = "Skript zwischen den Statements abgebrochen.";
    const outcome = { entries, lastResult, error, txId };
    finishTask(
      jobId,
      { statements: entries.map(({ result: _result, ...entry }) => entry), txId },
      error,
    );
    return outcome;
  } catch (failure) {
    finishTask(jobId, undefined, failure);
    throw failure;
  }
}
