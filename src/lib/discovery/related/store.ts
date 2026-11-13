import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createSafeJsonStorage } from "@/lib/buffered-storage";
import type { Capabilities } from "@/lib/db";
import { syncAcrossWindows } from "@/lib/window-sync";
import { featureAvailable, featureById } from "../catalog";
import { type FeatureUsage, onDiscoveryReset } from "../usage";

export const RELATED_STORAGE_KEY = "l8db.discovery.related";
export const MAX_RELATED_PAIRS = 512;

export interface RelatedSuggestion {
  from: string;
  to: string;
  pair: string;
}

export function relatedPair(from: string, to: string): string {
  return `${from}>${to}`;
}

export function relatedSuggestion(
  usedId: string,
  usage: FeatureUsage,
  shown: readonly string[],
  context: { capabilities?: Capabilities | null; easyMode?: boolean } = {},
): RelatedSuggestion | null {
  const entry = featureById(usedId);
  if (!entry?.related) return null;
  for (const to of entry.related) {
    const target = featureById(to);
    const pair = relatedPair(usedId, to);
    if (!target || to === usedId || usage[to] || shown.includes(pair)) continue;
    if (!featureAvailable(target, context)) continue;
    return { from: usedId, to, pair };
  }
  return null;
}

interface RelatedState {
  shown: string[];
  active: RelatedSuggestion | null;
  markShown: (suggestion: RelatedSuggestion) => void;
  dismiss: () => void;
  reset: () => void;
}

export const useRelatedStore = create<RelatedState>()(
  persist(
    (set) => ({
      shown: [],
      active: null,
      markShown: (suggestion) =>
        set((state) => {
          const shown = state.shown.includes(suggestion.pair)
            ? state.shown
            : [...state.shown, suggestion.pair];
          return {
            active: suggestion,
            shown: shown.length > MAX_RELATED_PAIRS ? shown.slice(-MAX_RELATED_PAIRS) : shown,
          };
        }),
      dismiss: () => set({ active: null }),
      reset: () => set({ shown: [], active: null }),
    }),
    {
      name: RELATED_STORAGE_KEY,
      storage: createSafeJsonStorage(),
      version: 1,
      partialize: (state) => ({ shown: state.shown }),
      merge: (persisted, current) => {
        const raw = (persisted as { shown?: unknown } | undefined)?.shown;
        const shown = Array.isArray(raw)
          ? raw.filter((pair): pair is string => typeof pair === "string").slice(-MAX_RELATED_PAIRS)
          : [];
        return { ...current, shown };
      },
    },
  ),
);

syncAcrossWindows(RELATED_STORAGE_KEY, () => void useRelatedStore.persist.rehydrate());
onDiscoveryReset(() => useRelatedStore.getState().reset());
