import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createSafeJsonStorage } from "@/lib/buffered-storage";
import { featureById } from "@/lib/discovery/catalog";
import type { FeatureEvent } from "@/lib/discovery/events";
import { onDiscoveryReset, useFeatureUsageStore } from "@/lib/discovery/usage";
import type { UsageStatistics } from "@/lib/usage-statistics";
import { syncAcrossWindows } from "@/lib/window-sync";
import {
  type AchievementInput,
  MAX_FAMILIES,
  newlyUnlocked,
  retroactiveInput,
  TRACKED_EVENTS,
} from "./engine";
import { ACHIEVEMENTS } from "./rules";

export const ACHIEVEMENTS_STORAGE_KEY = "l8db.discovery.achievements";
export const ACHIEVEMENT_SUMMARY = "summary";
const KNOWN = new Set(ACHIEVEMENTS.map((rule) => rule.id));
const FAMILY = /^[a-z0-9_]{1,32}$/;

interface AchievementsState {
  unlocked: Record<string, number>;
  counters: Record<string, number>;
  families: string[];
  primed: boolean;
  pending: string | null;
  summaryCount: number;
}

const initial = (): AchievementsState => ({
  unlocked: {},
  counters: {},
  families: [],
  primed: false,
  pending: null,
  summaryCount: 0,
});

export const useAchievementsStore = create<AchievementsState>()(
  persist(initial, {
    name: ACHIEVEMENTS_STORAGE_KEY,
    storage: createSafeJsonStorage(),
    version: 1,
    merge: (persisted, current) => {
      const saved = (persisted ?? {}) as Partial<AchievementsState>;
      const unlocked = Object.fromEntries(
        Object.entries(saved.unlocked ?? {}).filter(
          ([id, at]) => KNOWN.has(id) && Number.isFinite(at),
        ),
      );
      const counters = Object.fromEntries(
        Object.entries(saved.counters ?? {}).filter(
          ([name, count]) => TRACKED_EVENTS.has(name) && Number.isInteger(count) && count >= 0,
        ),
      );
      const families = Array.isArray(saved.families)
        ? [
            ...new Set(
              saved.families.filter((kind) => typeof kind === "string" && FAMILY.test(kind)),
            ),
          ].slice(0, MAX_FAMILIES)
        : [];
      const pending =
        typeof saved.pending === "string" &&
        (saved.pending === ACHIEVEMENT_SUMMARY || KNOWN.has(saved.pending))
          ? saved.pending
          : null;
      return {
        ...current,
        unlocked,
        counters,
        families,
        primed: saved.primed === true,
        pending,
        summaryCount: Number.isInteger(saved.summaryCount) ? (saved.summaryCount as number) : 0,
      };
    },
  }),
);

syncAcrossWindows(ACHIEVEMENTS_STORAGE_KEY, () => void useAchievementsStore.persist.rehydrate());
onDiscoveryReset(() => useAchievementsStore.setState(initial()));

function currentInput(): AchievementInput {
  const { counters, families } = useAchievementsStore.getState();
  return {
    usage: useFeatureUsageStore.getState().usage,
    counters,
    families,
    isCatalog: (id) => featureById(id) !== undefined,
  };
}

export function primeAchievements(statistics: UsageStatistics, now = Date.now()): number {
  const state = useAchievementsStore.getState();
  if (state.primed) return 0;
  const retro = retroactiveInput(statistics, state.counters, state.families);
  const input = { ...currentInput(), ...retro };
  const found = newlyUnlocked(input, state.unlocked);
  useAchievementsStore.setState({
    ...retro,
    primed: true,
    unlocked: { ...state.unlocked, ...Object.fromEntries(found.map((id) => [id, now])) },
    pending: found.length ? ACHIEVEMENT_SUMMARY : null,
    summaryCount: found.length,
  });
  return found.length;
}

export function evaluateAchievements(now = Date.now()): string[] {
  const state = useAchievementsStore.getState();
  if (!state.primed) return [];
  const found = newlyUnlocked(currentInput(), state.unlocked);
  if (!found.length) return found;
  useAchievementsStore.setState({
    unlocked: { ...state.unlocked, ...Object.fromEntries(found.map((id) => [id, now])) },
    pending: found.at(-1) ?? null,
  });
  return found;
}

export function recordAchievementEvent(event: FeatureEvent): string[] {
  const state = useAchievementsStore.getState();
  if (!state.primed) return [];
  const family = typeof event.data.family === "string" ? event.data.family : null;
  const tracked = TRACKED_EVENTS.has(event.name);
  const newFamily =
    family !== null &&
    FAMILY.test(family) &&
    !state.families.includes(family) &&
    state.families.length < MAX_FAMILIES;
  if (!tracked && !newFamily) return [];
  useAchievementsStore.setState({
    counters: tracked
      ? {
          ...state.counters,
          [event.name]: Math.min(1_000_000_000, (state.counters[event.name] ?? 0) + 1),
        }
      : state.counters,
    families: newFamily ? [...state.families, family] : state.families,
  });
  return evaluateAchievements(event.at);
}

export function clearPendingAchievement(): void {
  useAchievementsStore.setState({ pending: null });
}
