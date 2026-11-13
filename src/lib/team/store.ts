import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createSafeJsonStorage } from "@/lib/buffered-storage";
import { syncAcrossWindows } from "@/lib/window-sync";
import type { TeamTip } from "./tips";

export const TEAM_STORE_KEY = "l8db.team";

export interface TeamState {
  path: string | null;
  exists: boolean;
  lastSyncAt: number | null;
  lastError: string | null;
  warnings: string[];
  tips: TeamTip[];
}

export const useTeamStore = create<TeamState>()(
  persist(
    (): TeamState => ({
      path: null,
      exists: false,
      lastSyncAt: null,
      lastError: null,
      warnings: [],
      tips: [],
    }),
    {
      name: TEAM_STORE_KEY,
      storage: createSafeJsonStorage(),
      version: 1,
      migrate: () => ({}) as TeamState,
    },
  ),
);

syncAcrossWindows(TEAM_STORE_KEY, () => void useTeamStore.persist.rehydrate());
