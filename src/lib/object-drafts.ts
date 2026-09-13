import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface ObjectDraft {
  key: string;
  connectionId: string;
  database: string | null;
  title: string;
  objectKey: string;
  sql: string;
  base: string;
  updatedAt: number;
}

interface DraftsState {
  drafts: Record<string, ObjectDraft>;
  put: (draft: Omit<ObjectDraft, "updatedAt">) => void;
  remove: (key: string) => void;
}

export function objectDraftKey(connectionId: string, database: string | null, objectKey: string) {
  return JSON.stringify([connectionId, database, objectKey]);
}

export const useObjectDrafts = create<DraftsState>()(
  persist(
    (set) => ({
      drafts: {},
      put: (draft) =>
        set((state) => ({
          drafts: { ...state.drafts, [draft.key]: { ...draft, updatedAt: Date.now() } },
        })),
      remove: (key) =>
        set((state) => {
          const drafts = { ...state.drafts };
          delete drafts[key];
          return { drafts };
        }),
    }),
    { name: "l8db.object-drafts", partialize: (state) => ({ drafts: state.drafts }) },
  ),
);
