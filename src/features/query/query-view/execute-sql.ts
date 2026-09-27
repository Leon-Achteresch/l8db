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
import { useSettingsStore } from "@/lib/settings";
import { isTransactionalStatement, opensManagedTransaction } from "@/lib/sql-statements";
import { effectiveConnectionString } from "@/lib/ssh";
import { executeWithTransactionChanges } from "@/lib/transaction-sql-changes";
import { getQueryTransaction, useTransactionStore } from "@/lib/transactions";

interface ExecuteSqlOptions {
  connection: SavedConnection;
  database: string | null;
  sql: string;
  bound?: ParameterizedQuery;
  transactionsCapable: boolean;
  onJob: (id: string) => void;
}

export async function executeSqlWithTransactions({
  connection,
  database,
  sql,
  bound,
  transactionsCapable,
  onJob,
}: ExecuteSqlOptions): Promise<QueryResult> {
  const executionOptions = { onJob, confirmed: true };
  const store = useTransactionStore.getState();
  const existingTx = getQueryTransaction(connection.id, database);
  const isDml = isTransactionalStatement(sql, connection.kind);

  if (existingTx) {
    const { result: res, changes } = await runManagedOperation(existingTx.txId, () =>
      executeWithTransactionChanges(connection, existingTx.txId, bound ? "" : sql, () =>
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
          rowsAffected: res.rows_affected,
          detailsUnavailable:
            /^\s*(INSERT|UPDATE)\b/i.test(sql) && !changes.length && Number(res.rows_affected) > 0,
        },
        ...changes,
      ]) {
        store.addChange(existingTx.txId, {
          id: crypto.randomUUID(),
          timestamp: Date.now(),
          ...change,
        });
      }
      store.setPanelOpen(true);
    }
    return res;
  }
  if (
    opensManagedTransaction(sql, connection.kind) &&
    transactionsCapable &&
    useSettingsStore.getState().transactionsEnabled
  ) {
    const { txId } = await ensureManagedTransaction(connection, database ?? null, {
      type: "query",
    });
    const { result: res, changes } = await runManagedOperation(txId, () =>
      executeWithTransactionChanges(connection, txId, bound ? "" : sql, () =>
        bound
          ? executeInTransactionWithParams(txId, bound.sql, bound.values, executionOptions)
          : executeInTransaction(txId, sql, executionOptions),
      ),
    );
    for (const change of [
      {
        type: "query" as const,
        sql,
        rowsAffected: res.rows_affected,
        detailsUnavailable:
          /^\s*(INSERT|UPDATE)\b/i.test(sql) && !changes.length && Number(res.rows_affected) > 0,
      },
      ...changes,
    ]) {
      store.addChange(txId, { id: crypto.randomUUID(), timestamp: Date.now(), ...change });
    }
    store.setPanelOpen(true);
    return res;
  }
  return bound
    ? await executeQueryWithParams(
        connection.kind,
        effectiveConnectionString(connection),
        bound.sql,
        bound.values,
        database ?? undefined,
        executionOptions,
      )
    : await executeQuery(
        connection.kind,
        effectiveConnectionString(connection),
        sql,
        database ?? undefined,
        executionOptions,
      );
}
