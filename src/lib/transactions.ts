import { create } from "zustand";
import { persist } from "zustand/middleware";

import { listTransactions } from "@/lib/db";

export interface TransactionChange {
  id: string;
  type: "update" | "query" | "insert" | "delete";
  timestamp: number;
  schema?: string;
  table?: string;
  ctid?: string;
  oldValues?: Record<string, unknown>;
  newValues?: Record<string, string | null>;
  rowValues?: Record<string, unknown>;
  sql?: string;
  rowsAffected?: number | null;
}

export interface ActiveTransaction {
  txId: string;
  connectionId: string;
  connectionName: string;
  database?: string;
  scope?: TransactionScope;
  changes: TransactionChange[];
  startedAt: number;
}

export type TransactionScope =
  | { type: "connection" }
  | { type: "query" }
  | { type: "table"; schema: string; table: string };

interface TransactionStoreState {
  transactions: ActiveTransaction[];
  busyTransactions: Record<string, number>;
  finalizingTransactions: string[];
  panelOpen: boolean;
  togglePanel: () => void;
  setPanelOpen: (open: boolean) => void;
  addTransaction: (tx: ActiveTransaction) => void;
  removeTransaction: (txId: string) => void;
  addChange: (txId: string, change: TransactionChange) => void;
  syncWithBackend: () => Promise<void>;
}

export const useTransactionStore = create<TransactionStoreState>()(
  persist(
    (set, get) => ({
      transactions: [],
      busyTransactions: {},
      finalizingTransactions: [],
      panelOpen: false,

      togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),
      setPanelOpen: (open) => set({ panelOpen: open }),

      addTransaction: (tx) => set((s) => ({ transactions: [...s.transactions, tx] })),

      removeTransaction: (txId) =>
        set((s) => ({
          transactions: s.transactions.filter((t) => t.txId !== txId),
        })),

      addChange: (txId, change) =>
        set((s) => ({
          transactions: s.transactions.map((t) =>
            t.txId === txId ? { ...t, changes: [...t.changes, change] } : t,
          ),
        })),

      syncWithBackend: async () => {
        try {
          const activeIds = await listTransactions();
          const current = get().transactions;
          const alive = current.filter((t) => activeIds.includes(t.txId));
          if (alive.length !== current.length) {
            set({ transactions: alive });
          }
        } catch {
          return;
        }
      },
    }),
    {
      name: "l8db.transactions",
      partialize: (state) => ({
        transactions: state.transactions,
        panelOpen: state.panelOpen,
      }),
    },
  ),
);

export function getTransactionForConnection(connectionId: string): ActiveTransaction | undefined {
  return useTransactionStore.getState().transactions.find((t) => t.connectionId === connectionId);
}

export function findTransaction(
  transactions: ActiveTransaction[],
  connectionId: string,
  database: string | null | undefined,
  scope: TransactionScope,
): ActiveTransaction | undefined {
  const candidates = transactions.filter(
    (tx) => tx.connectionId === connectionId && (tx.database ?? null) === (database ?? null),
  );
  return (
    candidates.find((tx) => {
      if (tx.scope?.type !== scope.type) return false;
      return (
        scope.type !== "table" ||
        (tx.scope.type === "table" &&
          tx.scope.schema === scope.schema &&
          tx.scope.table === scope.table)
      );
    }) ?? candidates.find((tx) => !tx.scope || tx.scope.type === "connection")
  );
}

export function getQueryTransaction(connectionId: string, database?: string | null) {
  return findTransaction(useTransactionStore.getState().transactions, connectionId, database, {
    type: "query",
  });
}

export function getTableTransaction(
  connectionId: string,
  database: string | null | undefined,
  schema: string,
  table: string,
) {
  return findTransaction(useTransactionStore.getState().transactions, connectionId, database, {
    type: "table",
    schema,
    table,
  });
}
