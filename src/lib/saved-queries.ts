import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createSafeJsonStorage } from "@/lib/buffered-storage";
import {
  type SavedQueryOrigin,
  storedSavedQueries,
  toStoredSavedQuery,
} from "@/lib/saved-query-origin";
import { syncAcrossWindows } from "@/lib/window-sync";

export interface SavedQuery {
  id: string;
  name: string;
  sql: string;
  createdAt: number;
  origin?: SavedQueryOrigin;
}

interface SavedQueriesState {
  queries: SavedQuery[];
  saveQuery: (name: string, sql: string, origin?: SavedQueryOrigin | null) => SavedQuery;
  deleteQuery: (id: string) => void;
  updateQuery: (id: string, name: string, sql: string, origin?: SavedQueryOrigin | null) => void;
  importQueries: (queries: SavedQuery[]) => number;
}

export const useSavedQueriesStore = create<SavedQueriesState>()(
  persist(
    (set, get) => ({
      queries: [],

      saveQuery: (name, sql, origin) => {
        const q = toStoredSavedQuery({
          id: crypto.randomUUID(),
          name,
          sql,
          createdAt: Date.now(),
          origin,
        });
        set((state) => ({ queries: [q, ...state.queries] }));
        return q;
      },

      deleteQuery: (id) =>
        set((state) => ({
          queries: state.queries.filter((q) => q.id !== id),
        })),

      importQueries: (incoming) => {
        const known = new Set(get().queries.map((q) => q.id));
        const added = incoming
          .filter((q) => !known.has(q.id) && known.add(q.id))
          .map(toStoredSavedQuery);
        if (added.length) set((state) => ({ queries: [...added, ...state.queries] }));
        return added.length;
      },

      updateQuery: (id, name, sql, origin) =>
        set((state) => ({
          queries: state.queries.map((q) =>
            q.id === id
              ? toStoredSavedQuery({
                  ...q,
                  name,
                  sql,
                  origin: origin === undefined ? q.origin : origin,
                })
              : q,
          ),
        })),
    }),
    {
      name: "l8db.saved-queries",
      storage: createSafeJsonStorage(),
      partialize: (state) => ({ queries: state.queries.map(toStoredSavedQuery) }),
      merge: (persisted, current) => ({
        ...current,
        queries:
          storedSavedQueries((persisted as { queries?: unknown } | undefined)?.queries) ??
          current.queries,
      }),
    },
  ),
);

syncAcrossWindows("l8db.saved-queries", () => void useSavedQueriesStore.persist.rehydrate());

export function saveNamedQuery(
  name: string,
  sql: string,
  origin: SavedQueryOrigin | null,
): SavedQuery {
  const store = useSavedQueriesStore.getState();
  const existing = store.queries.find((query) => query.name.toLowerCase() === name.toLowerCase());
  if (!existing) return store.saveQuery(name, sql, origin);
  store.updateQuery(existing.id, name, sql, origin);
  return (
    useSavedQueriesStore.getState().queries.find((query) => query.id === existing.id) ??
    toStoredSavedQuery({ ...existing, name, sql, origin })
  );
}
