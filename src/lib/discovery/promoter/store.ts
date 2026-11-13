import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createSafeJsonStorage } from "@/lib/buffered-storage";
import { syncAcrossWindows } from "@/lib/window-sync";
import { onDiscoveryReset } from "../usage";
import { type PromoterStat, promoterHit } from "./engine";
import { PROMOTER_RULES } from "./rules";

export const PROMOTER_STORAGE_KEY = "l8db.discovery.promoter";

const RULES = new Map(PROMOTER_RULES.map((rule) => [rule.id, rule]));

interface PromoterState {
  stats: Record<string, PromoterStat>;
  active: string | null;
  hit: (ruleId: string, now?: number) => boolean;
  markShown: (ruleId: string, now?: number) => void;
  accept: (ruleId: string) => void;
  mute: (ruleId: string) => void;
  dismiss: () => void;
  reset: () => void;
}

function pruneStats(value: unknown): Record<string, PromoterStat> {
  const result: Record<string, PromoterStat> = {};
  if (!value || typeof value !== "object") return result;
  for (const [id, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!RULES.has(id) || !raw || typeof raw !== "object") continue;
    const stat = raw as Partial<PromoterStat>;
    result[id] = {
      hits: Number.isFinite(stat.hits) ? (stat.hits as number) : 0,
      shown: Number.isFinite(stat.shown) ? (stat.shown as number) : 0,
      lastHitAt: Number.isFinite(stat.lastHitAt) ? (stat.lastHitAt as number) : 0,
      lastShownAt: Number.isFinite(stat.lastShownAt) ? (stat.lastShownAt as number) : 0,
      ...(stat.muted ? { muted: true } : {}),
      ...(stat.accepted ? { accepted: true } : {}),
    };
  }
  return result;
}

function blank(): PromoterStat {
  return { hits: 0, shown: 0, lastHitAt: 0, lastShownAt: 0 };
}

export const usePromoterStore = create<PromoterState>()(
  persist(
    (set, get) => ({
      stats: {},
      active: null,
      hit: (ruleId, now = Date.now()) => {
        const rule = RULES.get(ruleId);
        if (!rule) return false;
        const { stat, show } = promoterHit(get().stats[ruleId], rule, now);
        if (stat !== get().stats[ruleId]) set({ stats: { ...get().stats, [ruleId]: stat } });
        return show;
      },
      markShown: (ruleId, now = Date.now()) =>
        set((state) => {
          const stat = state.stats[ruleId] ?? blank();
          return {
            active: ruleId,
            stats: {
              ...state.stats,
              [ruleId]: { ...stat, shown: stat.shown + 1, lastShownAt: now },
            },
          };
        }),
      accept: (ruleId) =>
        set((state) => ({
          active: state.active === ruleId ? null : state.active,
          stats: {
            ...state.stats,
            [ruleId]: { ...(state.stats[ruleId] ?? blank()), accepted: true },
          },
        })),
      mute: (ruleId) =>
        set((state) => ({
          active: state.active === ruleId ? null : state.active,
          stats: { ...state.stats, [ruleId]: { ...(state.stats[ruleId] ?? blank()), muted: true } },
        })),
      dismiss: () => set({ active: null }),
      reset: () => set({ stats: {}, active: null }),
    }),
    {
      name: PROMOTER_STORAGE_KEY,
      storage: createSafeJsonStorage(),
      version: 1,
      partialize: (state) => ({ stats: state.stats }),
      merge: (persisted, current) => ({
        ...current,
        stats: pruneStats((persisted as { stats?: unknown } | undefined)?.stats),
      }),
    },
  ),
);

syncAcrossWindows(PROMOTER_STORAGE_KEY, () => void usePromoterStore.persist.rehydrate());
onDiscoveryReset(() => usePromoterStore.getState().reset());
