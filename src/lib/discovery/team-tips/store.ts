import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createSafeJsonStorage } from "@/lib/buffered-storage";
import { onDiscoveryReset } from "@/lib/discovery/usage";
import type { TeamTip } from "@/lib/team/tips";
import { syncAcrossWindows } from "@/lib/window-sync";

export const TEAM_TIPS_STORAGE_KEY = "l8db.discovery.team-tips";
export const MAX_SEEN_TIPS = 200;

interface TeamTipsState {
  seen: Record<string, number>;
  markSeen: (id: string, at?: number) => void;
}

export function pruneSeen(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter((entry): entry is [string, number] => Number.isFinite(entry[1]))
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_SEEN_TIPS),
  );
}

export const useTeamTipsStore = create<TeamTipsState>()(
  persist(
    (set) => ({
      seen: {},
      markSeen: (id, at = Date.now()) =>
        set((state) => (state.seen[id] ? state : { seen: pruneSeen({ ...state.seen, [id]: at }) })),
    }),
    {
      name: TEAM_TIPS_STORAGE_KEY,
      storage: createSafeJsonStorage(),
      version: 1,
      partialize: ({ seen }) => ({ seen }),
      merge: (persisted, current) => ({
        ...current,
        seen: pruneSeen((persisted as { seen?: unknown } | undefined)?.seen),
      }),
    },
  ),
);

syncAcrossWindows(TEAM_TIPS_STORAGE_KEY, () => void useTeamTipsStore.persist.rehydrate());
onDiscoveryReset(() => useTeamTipsStore.setState({ seen: {} }));

export function nextTeamTip(
  tips: readonly TeamTip[],
  seen: Record<string, number>,
): TeamTip | null {
  return tips.find((tip) => seen[tip.id] === undefined) ?? null;
}
