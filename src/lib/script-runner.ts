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
import { sqlSearchPath } from "@/lib/db/sql-include";
import { ensureManagedTransaction, runManagedOperation } from "@/lib/managed-transactions";
import { supports } from "@/lib/providers";
import { useQueryHistoryStore } from "@/lib/query-history";
import { applySelectRowLimit } from "@/lib/select-row-limit";
import { toggleServerOutput } from "@/lib/server-output";
import { expandSessionViews, runSessionViewStatement, sessionViewsFor } from "@/lib/session-views";
import { readSqlText } from "@/lib/sql-file";
import { scriptPolicyIssue } from "@/lib/sql-safety";
import { isTransactionalStatement, splitSqlStatements } from "@/lib/sql-statements";
import { expandIncludes, type ScriptItem, scriptItems } from "@/lib/sql-statements/includes";
import {
  type AskVariables,
  applySqlPlusSetting,
  askMissingVariables,
  createSubstitutionState,
  parseSqlPlusCommand,
  type SubstitutionSession,
  substitute,
} from "@/lib/sql-statements/sqlplus";
import { effectiveConnectionString } from "@/lib/ssh";
import { finishTask, startTask, updateTask } from "@/lib/tasks";
import {
  executeWithTransactionChanges,
  refreshDatabaseChanges,
} from "@/lib/transaction-sql-changes";
import { getQueryTransaction, useTransactionStore } from "@/lib/transactions";

export interface ScriptRequest {
  connection: SavedConnection;
  database: string | null;
  sql: string;
  mode: ScriptRunMode;
  stopOnError?: boolean;
  selectRowLimit?: number;
  filePath?: string | null;
  variables?: SubstitutionSession;
  askVariables?: AskVariables;
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
  const oracle = connection.kind === "oracle";
  const items = split.commands.length
    ? await expandIncludes(scriptItems(split), {
        file: request.filePath ?? null,
        searchPath: await sqlSearchPath().catch(() => []),
        read: readSqlText,
      })
    : scriptItems(split);
  const shown = items.filter((item) => item.kind !== "command");
  if (!shown.length) throw new Error("Das Skript enthält keine ausführbaren Statements.");
  const session = request.variables ?? { state: createSubstitutionState(), answers: {} };
  const answers = oracle ? await askMissingVariables(items, session, request.askVariables) : {};
  if (!answers) throw new Error("Ausführung vom Benutzer abgebrochen.");
  const preview = { ...session.state, defines: { ...session.state.defines } };
  const executable = items
    .flatMap((item) => {
      if (item.kind === "command" && oracle)
        applySqlPlusSetting(parseSqlPlusCommand(item.text), preview);
      if (item.kind !== "sql") return [];
      return [oracle ? substitute(item.text, preview, answers).text : item.text];
    })
    .join(oracle ? "\n/\n" : "\n");
  const policyIssue = scriptPolicyIssue(executable, connection.kind, mode !== "autocommit");
  if (policyIssue) throw new Error(policyIssue);
  await confirmSqlExecution(connection.kind, url, executable, database ?? undefined);
  const existing = getQueryTransaction(connection.id, database);
  if (existing && mode !== "existing-transaction")
    throw new Error(
      "Für dieses Ziel besteht bereits eine Transaktion. Bitte diese verwenden oder zuerst abschließen.",
    );
  if (!existing && mode === "existing-transaction")
    throw new Error("Die ausgewählte Transaktion ist nicht mehr offen.");
  if (mode !== "autocommit" && !supports(connection, "transactions"))
    throw new Error("Dieser Provider unterstützt keine Skript-Transaktionen.");

  const entryOf = new Map<ScriptItem, ScriptRunEntry>();
  const entries: ScriptRunEntry[] = shown.map((item, index) => {
    const entry: ScriptRunEntry = {
      index,
      sql: item.text,
      start: item.start,
      end: item.end,
      status: "pending",
      durationMs: null,
      rowCount: null,
      rowsAffected: null,
      error: null,
      ...(item.source ? { source: item.source } : {}),
    };
    entryOf.set(item, entry);
    return entry;
  });
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
    let stopOnError = request.stopOnError !== false;
    let halted = false;
    const fail = (message: string) => {
      error = message;
      if (stopOnError || (txId && !oracle)) halted = true;
    };
    const switchServerOutput = async (enabled: boolean) => {
      if (!supports(connection, "server_output")) return;
      await toggleServerOutput(connection.kind, url, connection.id, enabled, database ?? undefined);
      const active = txId;
      if (active)
        await runManagedOperation(active, () =>
          executeInTransaction(
            active,
            enabled ? "BEGIN DBMS_OUTPUT.ENABLE(NULL); END;" : "BEGIN DBMS_OUTPUT.DISABLE; END;",
            { confirmed: true, track: false, session: jobId },
          ),
        );
    };
    for (const item of items) {
      const entry = entryOf.get(item);
      if (!entry) {
        const command = oracle && !stopped && !halted ? parseSqlPlusCommand(item.text) : null;
        if (command?.type === "whenever") stopOnError = command.exit;
        else if (command?.type === "exit") halted = true;
        else if (command?.type === "serveroutput") await switchServerOutput(command.enabled);
        else if (command) applySqlPlusSetting(command, session.state);
        continue;
      }
      if (stopped || halted) {
        entry.status = "skipped";
        publish();
        continue;
      }
      if (oracle && item.kind === "sql")
        entry.sql = substitute(item.text, session.state, answers).text;
      const failure = item.error;
      if (failure) {
        entry.status = "error";
        entry.error = failure;
        fail(failure);
        publish();
        continue;
      }
      entry.status = "running";
      publish();
      const started = performance.now();
      const options = {
        confirmed: true,
        track: false,
        session: jobId,
        onJob: (id: string) => {
          currentJob = id;
        },
      };
      try {
        const executionSql = applySelectRowLimit(
          expandSessionViews(entry.sql, sessionViewsFor(connection.id, database), connection.kind),
          connection.kind,
          request.selectRowLimit ?? 0,
        );
        const activeTxId = txId;
        const sessionResult = await runSessionViewStatement(connection, database, entry.sql);
        const tracked = sessionResult
          ? { result: sessionResult, changes: [] }
          : activeTxId
            ? await runManagedOperation(activeTxId, () =>
                executeWithTransactionChanges(connection, database, activeTxId, entry.sql, () =>
                  executeInTransaction(activeTxId, executionSql, options),
                ),
              )
            : {
                result: await executeQuery(
                  connection.kind,
                  url,
                  executionSql,
                  database ?? undefined,
                  options,
                ),
                changes: [],
              };
        const { result } = tracked;
        entry.result = result;
        entry.status = "success";
        entry.rowCount = result.columns.length ? result.rows.length : null;
        entry.rowsAffected = result.rows_affected == null ? null : Number(result.rows_affected);
        lastResult = result;
        if (txId && isTransactionalStatement(entry.sql, connection.kind)) {
          for (const change of [
            {
              type: "query" as const,
              sql: entry.sql,
              rowsAffected: connection.kind === "dynamodb" ? null : result.rows_affected,
              planned: connection.kind === "dynamodb",
              detailsUnavailable:
                /^\s*(INSERT|UPDATE|DELETE)\b/i.test(entry.sql) &&
                !tracked.changes.length &&
                Number(result.rows_affected) > 0,
            },
            ...tracked.changes,
          ]) {
            useTransactionStore.getState().addChange(txId, {
              id: crypto.randomUUID(),
              timestamp: Date.now(),
              ...change,
            });
          }
        }
      } catch (failure) {
        entry.status = "error";
        entry.error = failure instanceof Error ? failure.message : String(failure);
        fail(entry.error);
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
    const touchedTxId = txId;
    if (touchedTxId && entries.some((entry) => entry.status === "success"))
      await runManagedOperation(touchedTxId, () => refreshDatabaseChanges(connection, touchedTxId));
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
