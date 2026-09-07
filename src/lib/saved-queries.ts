import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface SavedQuery {
  id: string;
  name: string;
  sql: string;
  createdAt: number;
}

interface SavedQueriesState {
  queries: SavedQuery[];
  saveQuery: (name: string, sql: string) => SavedQuery;
  deleteQuery: (id: string) => void;
  updateQuery: (id: string, name: string, sql: string) => void;
  importQueries: (queries: SavedQuery[]) => number;
}

export const useSavedQueriesStore = create<SavedQueriesState>()(
  persist(
    (set) => ({
      queries: [],

      saveQuery: (name, sql) => {
        const q: SavedQuery = {
          id: crypto.randomUUID(),
          name,
          sql,
          createdAt: Date.now(),
        };
        set((state) => ({ queries: [q, ...state.queries] }));
        return q;
      },

      deleteQuery: (id) =>
        set((state) => ({
          queries: state.queries.filter((q) => q.id !== id),
        })),

      importQueries: (incoming) => {
        if (incoming.length === 0) return 0;
        set((state) => {
          const known = new Set(state.queries.map((q) => q.id));
          const added = incoming.filter((q) => !known.has(q.id));
          return { queries: [...added, ...state.queries] };
        });
        return incoming.length;
      },

      updateQuery: (id, name, sql) =>
        set((state) => ({
          queries: state.queries.map((q) => (q.id === id ? { ...q, name, sql } : q)),
        })),
    }),
    {
      name: "l8db.saved-queries",
      partialize: (state) => ({ queries: state.queries }),
    },
  ),
);
