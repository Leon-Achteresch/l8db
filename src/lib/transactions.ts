import { create } from "zustand";

export interface TransactionChange {
  id: string;
  type: "update" | "query";
  timestamp: number;
  schema?: string;
  table?: string;
  ctid?: string;
  oldValues?: Record<string, unknown>;
  newValues?: Record<string, string | null>;
  sql?: string;
  rowsAffected?: number | null;
}

export interface ActiveTransaction {
  txId: string;
  connectionId: string;
  connectionName: string;
  database?: string;
  changes: TransactionChange[];
  startedAt: number;
}

interface TransactionStoreState {
  transactions: ActiveTransaction[];
  panelOpen: boolean;
  togglePanel: () => void;
  setPanelOpen: (open: boolean) => void;
  addTransaction: (tx: ActiveTransaction) => void;
  removeTransaction: (txId: string) => void;
  addChange: (txId: string, change: TransactionChange) => void;
}

export const useTransactionStore = create<TransactionStoreState>()((set) => ({
  transactions: [],
  panelOpen: false,

  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),
  setPanelOpen: (open) => set({ panelOpen: open }),

  addTransaction: (tx) =>
    set((s) => ({ transactions: [...s.transactions, tx] })),

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
}));

export function getTransactionForConnection(
  connectionId: string,
): ActiveTransaction | undefined {
  return useTransactionStore
    .getState()
    .transactions.find((t) => t.connectionId === connectionId);
}
