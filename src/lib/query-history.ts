import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface QueryHistoryEntry {
  id: string;
  connectionId: string;
  database: string | null;
  sql: string;
  ranAt: number;
  durationMs: number | null;
  rowCount: number | null;
  error: string | null;
}

interface QueryHistoryState {
  entries: QueryHistoryEntry[];
  record: (entry: Omit<QueryHistoryEntry, "id" | "ranAt">) => void;
  removeEntry: (id: string) => void;
  clearForConnection: (connectionId: string) => void;
  clearAll: () => void;
}

const MAX_ENTRIES = 200;
const MAX_SQL_LENGTH = 20000;

function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
}

export const useQueryHistoryStore = create<QueryHistoryState>()(
  persist(
    (set) => ({
      entries: [],
      record: (entry) =>
        set((state) => ({
          entries: [
            {
              ...entry,
              id: createId(),
              ranAt: Date.now(),
              sql: entry.sql.slice(0, MAX_SQL_LENGTH),
            },
            ...state.entries,
          ].slice(0, MAX_ENTRIES),
        })),
      removeEntry: (id) =>
        set((state) => ({
          entries: state.entries.filter((entry) => entry.id !== id),
        })),
      clearForConnection: (connectionId) =>
        set((state) => ({
          entries: state.entries.filter((entry) => entry.connectionId !== connectionId),
        })),
      clearAll: () => set({ entries: [] }),
    }),
    {
      name: "l8db.query-history",
      partialize: (state) => ({ entries: state.entries }),
    },
  ),
);
