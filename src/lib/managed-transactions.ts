import type { SavedConnection } from "@/lib/connections";
import { useConnectionsStore } from "@/lib/connections/store";
import { beginTransaction, commitTransaction, rollbackTransaction } from "@/lib/db";
import { isProduction, productionConfirmTexts } from "@/lib/environments";
import { supports } from "@/lib/providers";
import { useSettingsStore } from "@/lib/settings";
import { requestSqlConfirmation } from "@/lib/sql-confirmation";
import { type DestructiveStatement, destructiveStatements } from "@/lib/sql-safety";
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
  } catch (error) {
    useTransactionStore.setState((state) => ({
      panelOpen: true,
      transactions: state.transactions.map((tx) =>
        tx.txId === txId ? { ...tx, lastError: String(error) } : tx,
      ),
    }));
    throw error;
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

function changeLabel(change: Omit<TransactionChange, "id" | "timestamp">): string {
  const target = [change.schema, change.table].filter(Boolean).join(".");
  const values = JSON.stringify(change.rowValues ?? change.oldValues ?? {});
  return `${target} ${values.length > 240 ? `${values.slice(0, 240)}…` : values}`.trim();
}

export async function confirmProductionCommit(
  connectionId: string,
  database: string | null | undefined,
  changes: Omit<TransactionChange, "id" | "timestamp">[],
): Promise<void> {
  const connection = useConnectionsStore
    .getState()
    .connections.find((entry) => entry.id === connectionId);
  if (!connection || !isProduction(connection)) return;
  const risky: DestructiveStatement[] = [
    ...changes
      .filter((change) => change.type === "delete")
      .map((change) => ({ sql: changeLabel(change), reason: "Zeile löschen" })),
    ...changes.flatMap((change) =>
      change.type === "query" && change.sql
        ? destructiveStatements(change.sql, connection.kind, { strict: true })
        : [],
    ),
  ];
  if (!risky.length && !useSettingsStore.getState().productionConfirmCommit) return;
  const accepted = await requestSqlConfirmation({
    connection: connection.name,
    database: database ?? null,
    statements: risky.length
      ? risky
      : [{ sql: `${changes.length} Änderung(en)`, reason: "Commit auf Produktion" }],
    confirmTexts: risky.length ? productionConfirmTexts(connection, database) : undefined,
    title: "Auf Produktion committen?",
    description: "Die Änderungen werden dauerhaft in die Produktionsdatenbank geschrieben.",
    confirmLabel: "Committen",
  });
  if (!accepted) throw new Error("Commit vom Benutzer abgebrochen.");
}

export async function finishManagedTransaction(txId: string, commit: boolean): Promise<void> {
  const state = useTransactionStore.getState();
  const tx = state.transactions.find((entry) => entry.txId === txId);
  if (commit && tx) await confirmProductionCommit(tx.connectionId, tx.database, tx.changes);
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
    await confirmProductionCommit(connection.id, database, [change(result)]);
    await commitTransaction(txId);
    return result;
  } catch (err) {
    await rollbackTransaction(txId).catch(() => undefined);
    throw err;
  }
}
