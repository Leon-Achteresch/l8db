import type { SavedConnection } from "@/lib/connections";
import { beginTransaction, commitTransaction, rollbackTransaction } from "@/lib/db";
import { supports } from "@/lib/providers";
import { useSettingsStore } from "@/lib/settings";
import { effectiveConnectionString } from "@/lib/ssh";
import {
  type ActiveTransaction,
  findTransaction,
  type TransactionChange,
  type TransactionScope,
  useTransactionStore,
} from "@/lib/transactions";

const pendingTransactions = new Map<string, Promise<ActiveTransaction>>();

export function separatesTableTransactions(connection: Pick<SavedConnection, "kind">) {
  return (
    useSettingsStore.getState().transactionsPerTable && supports(connection, "table_transactions")
  );
}

export function ensureManagedTransaction(
  connection: SavedConnection,
  database: string | null,
  requestedScope: TransactionScope,
): Promise<ActiveTransaction> {
  const scope = separatesTableTransactions(connection)
    ? requestedScope
    : ({ type: "connection" } as const);
  const existing = findTransaction(
    useTransactionStore.getState().transactions,
    connection.id,
    database,
    scope,
  );
  if (existing) return Promise.resolve(existing);
  const key = JSON.stringify([
    connection.id,
    database,
    scope.type,
    scope.type === "table" ? scope.schema : null,
    scope.type === "table" ? scope.table : null,
  ]);
  let pending = pendingTransactions.get(key);
  if (!pending) {
    pending = beginTransaction(
      connection.kind,
      effectiveConnectionString(connection),
      database ?? undefined,
    )
      .then((txId) => {
        const tx: ActiveTransaction = {
          txId,
          connectionId: connection.id,
          connectionName: connection.name,
          database: database ?? undefined,
          scope,
          changes: [],
          startedAt: Date.now(),
        };
        useTransactionStore.getState().addTransaction(tx);
        return tx;
      })
      .finally(() => pendingTransactions.delete(key));
    pendingTransactions.set(key, pending);
  }
  return pending;
}

export async function runManagedOperation<T>(txId: string, op: () => Promise<T>): Promise<T> {
  if (useTransactionStore.getState().finalizingTransactions.includes(txId)) {
    throw new Error("Die Transaktion wird gerade abgeschlossen.");
  }
  useTransactionStore.setState((state) => ({
    busyTransactions: {
      ...state.busyTransactions,
      [txId]: (state.busyTransactions[txId] ?? 0) + 1,
    },
  }));
  try {
    return await op();
  } finally {
    useTransactionStore.setState((state) => {
      const busyTransactions = { ...state.busyTransactions };
      const remaining = (busyTransactions[txId] ?? 1) - 1;
      if (remaining > 0) busyTransactions[txId] = remaining;
      else delete busyTransactions[txId];
      return { busyTransactions };
    });
  }
}

export async function finishManagedTransaction(txId: string, commit: boolean): Promise<void> {
  const state = useTransactionStore.getState();
  if (state.busyTransactions[txId] || state.finalizingTransactions.includes(txId)) {
    throw new Error("Bitte die laufende Operation dieser Transaktion abwarten.");
  }
  useTransactionStore.setState({
    finalizingTransactions: [...state.finalizingTransactions, txId],
  });
  try {
    if (commit) await commitTransaction(txId);
    else await rollbackTransaction(txId);
    useTransactionStore.getState().removeTransaction(txId);
  } finally {
    useTransactionStore.setState((current) => ({
      finalizingTransactions: current.finalizingTransactions.filter((id) => id !== txId),
    }));
  }
}

export async function runTableTransaction<T>(
  connection: SavedConnection,
  database: string | null,
  schema: string,
  table: string,
  op: (txId: string) => Promise<T>,
  change: (result: T) => Omit<TransactionChange, "id" | "timestamp">,
): Promise<T> {
  const scope = { type: "table", schema, table } as const;
  const store = useTransactionStore.getState();
  if (
    findTransaction(store.transactions, connection.id, database, scope) ||
    useSettingsStore.getState().transactionsEnabled
  ) {
    const tx = await ensureManagedTransaction(connection, database, scope);
    return runManagedOperation(tx.txId, async () => {
      const result = await op(tx.txId);
      store.addChange(tx.txId, {
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        ...change(result),
      });
      store.setPanelOpen(true);
      return result;
    });
  }
  const txId = await beginTransaction(
    connection.kind,
    effectiveConnectionString(connection),
    database ?? undefined,
  );
  try {
    const result = await op(txId);
    await commitTransaction(txId);
    return result;
  } catch (err) {
    await rollbackTransaction(txId).catch(() => undefined);
    throw err;
  }
}
