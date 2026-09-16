import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";

export interface QueryHistoryEntry {
  id: string;
  connectionId: string;
  database: string | null;
  sql: string;
  ranAt: number;
  durationMs: number | null;
  rowCount: number | null;
  error: string | null;
  truncated?: boolean;
  originalSqlLength?: number;
}

interface QueryHistoryState {
  entries: QueryHistoryEntry[];
  retentionLimit: number;
  setRetentionLimit: (limit: number) => void;
  restore: (entries: QueryHistoryEntry[]) => void;
  record: (entry: Omit<QueryHistoryEntry, "id" | "ranAt">) => void;
  removeEntry: (id: string) => void;
  clearForConnection: (connectionId: string) => void;
  clearAll: () => void;
}

export const DEFAULT_HISTORY_LIMIT = 500;
export const MAX_HISTORY_SQL_LENGTH = 200000;
export const MAX_HISTORY_TOTAL_SQL_LENGTH = 2_000_000;

function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
}

export function retainHistory(
  entries: QueryHistoryEntry[],
  limit: number,
  budget = MAX_HISTORY_TOTAL_SQL_LENGTH,
): QueryHistoryEntry[] {
  const counts = new Map<string, number>();
  const seen = new Set<string>();
  let used = 0;
  return [...entries]
    .sort((a, b) => b.ranAt - a.ranAt)
    .filter((entry) => {
      if (seen.has(entry.id)) return false;
      seen.add(entry.id);
      const count = counts.get(entry.connectionId) ?? 0;
      counts.set(entry.connectionId, count + 1);
      used += entry.sql.length;
      return count < limit && used <= budget;
    });
}

const quotaSafeStorage: StateStorage = {
  getItem: (name) => localStorage.getItem(name),
  removeItem: (name) => localStorage.removeItem(name),
  setItem: (name, value) => {
    let payload = value;
    for (;;) {
      try {
        localStorage.setItem(name, payload);
        return;
      } catch (error) {
        const parsed = JSON.parse(payload) as { state?: { entries?: QueryHistoryEntry[] } };
        const entries = parsed.state?.entries ?? [];
        if (entries.length === 0) throw error;
        parsed.state = {
          ...parsed.state,
          entries: entries.slice(0, Math.floor(entries.length / 2)),
        };
        payload = JSON.stringify(parsed);
      }
    }
  },
};

export const useQueryHistoryStore = create<QueryHistoryState>()(
  persist(
    (set) => ({
      entries: [],
      retentionLimit: DEFAULT_HISTORY_LIMIT,
      setRetentionLimit: (value) =>
        set((state) => {
          const retentionLimit = Math.min(
            5000,
            Math.max(50, Math.round(Number.isFinite(value) ? value : DEFAULT_HISTORY_LIMIT)),
          );
          return { retentionLimit, entries: retainHistory(state.entries, retentionLimit) };
        }),
      restore: (entries) =>
        set((state) => ({
          entries: retainHistory([...entries, ...state.entries], state.retentionLimit),
        })),
      record: (entry) =>
        set((state) => ({
          entries: retainHistory(
            [
              {
                ...entry,
                id: createId(),
                ranAt: Date.now(),
                sql: entry.sql.slice(0, MAX_HISTORY_SQL_LENGTH),
                truncated: entry.sql.length > MAX_HISTORY_SQL_LENGTH,
                originalSqlLength: entry.sql.length,
              },
              ...state.entries,
            ],
            state.retentionLimit,
          ),
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
      storage: createJSONStorage(() => quotaSafeStorage),
      merge: (saved, current) => {
        const state = saved as Partial<QueryHistoryState> | undefined;
        const retentionLimit = Math.min(
          5000,
          Math.max(
            50,
            Math.round(
              Number.isFinite(state?.retentionLimit)
                ? state!.retentionLimit!
                : DEFAULT_HISTORY_LIMIT,
            ),
          ),
        );
        return {
          ...current,
          retentionLimit,
          entries: retainHistory(state?.entries ?? [], retentionLimit),
        };
      },
      partialize: (state) => ({ entries: state.entries, retentionLimit: state.retentionLimit }),
    },
  ),
);
