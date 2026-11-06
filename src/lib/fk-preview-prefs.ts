import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createSafeJsonStorage } from "@/lib/buffered-storage";

interface FkPreviewPrefsState {
  pinned: Record<string, string[]>;
  togglePinned: (key: string, column: string) => void;
}

export const useFkPreviewPrefs = create<FkPreviewPrefsState>()(
  persist(
    (set) => ({
      pinned: {},
      togglePinned: (key, column) =>
        set((state) => {
          const current = state.pinned[key] ?? [];
          const next = current.includes(column)
            ? current.filter((c) => c !== column)
            : [...current, column];
          const pinned = { ...state.pinned };
          if (next.length) pinned[key] = next;
          else delete pinned[key];
          return { pinned };
        }),
    }),
    { name: "l8db.fk-preview", storage: createSafeJsonStorage() },
  ),
);

export function fkPreviewKey(connectionId: string, schema: string, table: string): string {
  return JSON.stringify([connectionId, schema, table]);
}
