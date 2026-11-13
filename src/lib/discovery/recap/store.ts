import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createSafeJsonStorage } from "@/lib/buffered-storage";
import { onDiscoveryReset } from "@/lib/discovery/usage";
import { useSettingsStore } from "@/lib/settings";
import { syncAcrossWindows } from "@/lib/window-sync";
import { dayKey } from "./model";

export const RECAP_STORAGE_KEY = "l8db.discovery.recap";
export const MAX_RECAP_DAYS = 400;
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

interface RecapState {
  days: Record<string, number>;
  longest: { year: number; ms: number };
  offeredYear: number | null;
  record: (at?: number, durationMs?: number) => void;
  markOffered: (year: number) => void;
}

export function pruneDays(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(
        (entry): entry is [string, number] =>
          DAY_KEY.test(entry[0]) && Number.isInteger(entry[1]) && (entry[1] as number) > 0,
      )
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .slice(0, MAX_RECAP_DAYS),
  );
}

const initial = () => ({ days: {}, longest: { year: 0, ms: 0 }, offeredYear: null });

export const useRecapStore = create<RecapState>()(
  persist(
    (set, get) => ({
      ...initial(),
      record: (at = Date.now(), durationMs = 0) => {
        const date = new Date(at);
        const key = dayKey(date);
        const { days, longest } = get();
        const next = { ...days, [key]: Math.min(1_000_000, (days[key] ?? 0) + 1) };
        const year = date.getFullYear();
        const ms = Math.min(86_400_000, Math.max(0, Math.round(durationMs)));
        set({
          days: Object.keys(next).length > MAX_RECAP_DAYS ? pruneDays(next) : next,
          longest: longest.year !== year || ms > longest.ms ? { year, ms } : longest,
        });
      },
      markOffered: (offeredYear) => set({ offeredYear }),
    }),
    {
      name: RECAP_STORAGE_KEY,
      storage: createSafeJsonStorage(),
      version: 1,
      partialize: ({ days, longest, offeredYear }) => ({ days, longest, offeredYear }),
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<RecapState>;
        const longest =
          saved.longest &&
          Number.isInteger(saved.longest.year) &&
          Number.isFinite(saved.longest.ms) &&
          saved.longest.ms >= 0
            ? { year: saved.longest.year, ms: saved.longest.ms }
            : { year: 0, ms: 0 };
        return {
          ...current,
          days: pruneDays(saved.days),
          longest,
          offeredYear: Number.isInteger(saved.offeredYear) ? (saved.offeredYear as number) : null,
        };
      },
    },
  ),
);

syncAcrossWindows(RECAP_STORAGE_KEY, () => void useRecapStore.persist.rehydrate());
onDiscoveryReset(() => useRecapStore.setState(initial()));

export function recordRecapActivity(at = Date.now(), durationMs = 0): boolean {
  if (!useSettingsStore.getState().localUsageStats) return false;
  useRecapStore.getState().record(at, durationMs);
  return true;
}
