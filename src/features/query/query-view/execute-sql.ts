import type { ParameterizedQuery } from "@/lib/bind-params";
import type { SavedConnection } from "@/lib/connections";
import {
  executeInTransaction,
  executeInTransactionWithParams,
  executeQuery,
  executeQueryWithParams,
  type QueryResult,
} from "@/lib/db";
import { ensureManagedTransaction, runManagedOperation } from "@/lib/managed-transactions";
import { withAdapterResultTiming, withoutMeasuredQueryTiming } from "@/lib/query-result-timing";
import { applySelectRowLimit, DEFAULT_SELECT_ROW_LIMIT } from "@/lib/select-row-limit";
import { expandSessionViews, runSessionViewStatement, sessionViewsFor } from "@/lib/session-views";
import { useSettingsStore } from "@/lib/settings";
import { analyzedSql, managedQueryIssue } from "@/lib/sql-safety";
import { isTransactionalStatement, opensManagedTransaction } from "@/lib/sql-statements";
import { effectiveConnectionString } from "@/lib/ssh";
import {
  executeWithTransactionChanges,
  refreshDatabaseChanges,
} from "@/lib/transaction-sql-changes";
import { getQueryTransaction, useTransactionStore } from "@/lib/transactions";

interface ExecuteSqlOptions {
  connection: SavedConnection;
  database: string | null;
  sql: string;
  bound?: ParameterizedQuery;
  transactionsCapable: boolean;
  onJob: (id: string) => void;
  rowLimit?: number | null;
}

export async function executeSqlWithTransactions({
  connection,
  database,
  sql,
  bound,
  transactionsCapable,
  onJob,
  rowLimit = DEFAULT_SELECT_ROW_LIMIT,
}: ExecuteSqlOptions): Promise<QueryResult> {
  const intercepted = await runSessionViewStatement(connection, database, sql);
  if (intercepted) return withoutMeasuredQueryTiming(intercepted);
  const sessionViews = sessionViewsFor(connection.id, database);
  let limited = false;
  const limit = (text: string) => {
    const expanded = expandSessionViews(text, sessionViews, connection.kind);
    if (rowLimit === null) return expanded;
    const next = applySelectRowLimit(expanded, connection.kind, rowLimit);
    limited ||= next !== expanded;
    return next;
  };
  sql = limit(sql);
  if (bound) bound = { ...bound, sql: limit(bound.sql) };
  const mark = (res: QueryResult): QueryResult =>
    limited && rowLimit && res.columns.length > 0 && res.rows.length >= rowLimit
      ? { ...res, autoLimit: rowLimit }
      : res;
  const executionOptions = { onJob, confirmed: true };
  const store = useTransactionStore.getState();
  const existingTx = getQueryTransaction(connection.id, database);
  const classified = analyzedSql(sql, connection.kind);
  const isDml = isTransactionalStatement(classified, connection.kind);
  const rejectUnmanageable = () => {
    const issue = managedQueryIssue(sql, connection.kind);
    if (issue) throw new Error(issue);
  };

  if (existingTx) {
    rejectUnmanageable();
    const { result: res, changes } = await runManagedOperation(existingTx.txId, () =>
      executeWithTransactionChanges(connection, database, existingTx.txId, bound ? "" : sql, () =>
        bound
          ? executeInTransactionWithParams(
              existingTx.txId,
              bound.sql,
              bound.values,
              executionOptions,
            )
          : executeInTransaction(existingTx.txId, sql, executionOptions),
      ),
    );
    if (isDml) {
      for (const change of [
        {
          type: "query" as const,
          sql,
          rowsAffected: connection.kind === "dynamodb" ? null : res.rows_affected,
          planned: connection.kind === "dynamodb",
          detailsUnavailable:
            /^\s*(INSERT|UPDATE|DELETE)\b/i.test(sql) &&
            !changes.length &&
            Number(res.rows_affected) > 0,
        },
        ...changes,
      ]) {
        store.addChange(existingTx.txId, {
          id: crypto.randomUUID(),
          timestamp: Date.now(),
          ...change,
        });
      }
      await runManagedOperation(existingTx.txId, () =>
        refreshDatabaseChanges(connection, existingTx.txId),
      );
      store.setPanelOpen(true);
    }
    return mark(withAdapterResultTiming(res));
  }
  if (
    opensManagedTransaction(classified, connection.kind) &&
    transactionsCapable &&
    useSettingsStore.getState().transactionsEnabled &&
    !(connection.kind === "oracle" && managedQueryIssue(sql, connection.kind))
  ) {
    rejectUnmanageable();
    const { txId } = await ensureManagedTransaction(connection, database ?? null, {
      type: "query",
    });
    const { result: res, changes } = await runManagedOperation(txId, () =>
      executeWithTransactionChanges(connection, database, txId, bound ? "" : sql, () =>
        bound
          ? executeInTransactionWithParams(txId, bound.sql, bound.values, executionOptions)
          : executeInTransaction(txId, sql, executionOptions),
      ),
    );
    for (const change of [
      {
        type: "query" as const,
        sql,
        rowsAffected: connection.kind === "dynamodb" ? null : res.rows_affected,
        planned: connection.kind === "dynamodb",
        detailsUnavailable:
          /^\s*(INSERT|UPDATE|DELETE)\b/i.test(sql) &&
          !changes.length &&
          Number(res.rows_affected) > 0,
      },
      ...changes,
    ]) {
      store.addChange(txId, { id: crypto.randomUUID(), timestamp: Date.now(), ...change });
    }
    await runManagedOperation(txId, () => refreshDatabaseChanges(connection, txId));
    store.setPanelOpen(true);
    return mark(withAdapterResultTiming(res));
  }
  const kind = connection.kind;
  const result = bound
    ? await executeQueryWithParams(
        kind,
        effectiveConnectionString(connection),
        bound.sql,
        bound.values,
        database ?? undefined,
        executionOptions,
      )
    : await executeQuery(
        kind,
        effectiveConnectionString(connection),
        sql,
        database ?? undefined,
        executionOptions,
      );
  return mark(withAdapterResultTiming(result, kind));
}
