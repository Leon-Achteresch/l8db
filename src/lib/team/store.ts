import { create } from "zustand";
import { persist } from "zustand/middleware";
import { syncAcrossWindows } from "@/lib/window-sync";

export const TEAM_STORE_KEY = "l8db.team";

export interface TeamState {
  path: string | null;
  exists: boolean;
  lastSyncAt: number | null;
  lastError: string | null;
  warnings: string[];
}

export const useTeamStore = create<TeamState>()(
  persist(
    (): TeamState => ({
      path: null,
      exists: false,
      lastSyncAt: null,
      lastError: null,
      warnings: [],
    }),
    { name: TEAM_STORE_KEY, version: 1, migrate: () => ({}) as TeamState },
  ),
);

syncAcrossWindows(TEAM_STORE_KEY, () => void useTeamStore.persist.rehydrate());
