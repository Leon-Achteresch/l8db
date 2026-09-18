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
import { isTransactionalStatement } from "@/lib/sql-statements";
import { effectiveConnectionString } from "@/lib/ssh";
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
    const res = bound
      ? await runManagedOperation(existingTx.txId, () =>
          executeInTransactionWithParams(
            existingTx.txId,
            bound.sql,
            bound.values,
            executionOptions,
          ),
        )
      : await runManagedOperation(existingTx.txId, () =>
          executeInTransaction(existingTx.txId, sql, executionOptions),
        );
    if (isDml) {
      store.addChange(existingTx.txId, {
        id: crypto.randomUUID(),
        type: "query",
        timestamp: Date.now(),
        sql,
        rowsAffected: res.rows_affected,
      });
      store.setPanelOpen(true);
    }
    return res;
  }
  if (isDml && transactionsCapable && useSettingsStore.getState().transactionsEnabled) {
    const { txId } = await ensureManagedTransaction(connection, database ?? null, {
      type: "query",
    });
    const res = bound
      ? await runManagedOperation(txId, () =>
          executeInTransactionWithParams(txId, bound.sql, bound.values, executionOptions),
        )
      : await runManagedOperation(txId, () => executeInTransaction(txId, sql, executionOptions));
    store.addChange(txId, {
      id: crypto.randomUUID(),
      type: "query",
      timestamp: Date.now(),
      sql,
      rowsAffected: res.rows_affected,
    });
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
