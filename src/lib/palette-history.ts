import { create } from "zustand";
import { persist } from "zustand/middleware";
import { syncAcrossWindows } from "@/lib/window-sync";

export type PaletteUsage = { count: number; last: number };
export type PaletteHistory = Record<string, PaletteUsage>;

const MAX_ENTRIES = 100;

export function recordPaletteUse(history: PaletteHistory, id: string, now: number) {
  const next = { ...history, [id]: { count: (history[id]?.count ?? 0) + 1, last: now } };
  const entries = Object.entries(next);
  if (entries.length <= MAX_ENTRIES) return next;
  return Object.fromEntries(entries.sort(([, a], [, b]) => b.last - a.last).slice(0, MAX_ENTRIES));
}

type PaletteHistoryState = {
  history: PaletteHistory;
  record: (id: string) => void;
};

export const usePaletteHistoryStore = create<PaletteHistoryState>()(
  persist(
    (set) => ({
      history: {},
      record: (id) =>
        set((state) => ({ history: recordPaletteUse(state.history, id, Date.now()) })),
    }),
    { name: "l8db.palette-history" },
  ),
);

syncAcrossWindows("l8db.palette-history", () => void usePaletteHistoryStore.persist.rehydrate());
