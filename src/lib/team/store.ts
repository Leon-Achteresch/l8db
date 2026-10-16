import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { TeamUser } from "@/lib/db/team";
import { syncAcrossWindows } from "@/lib/window-sync";

export const TEAM_STORE_KEY = "l8db.team";

export interface TeamState {
  hubUrl: string;
  user: TeamUser | null;
  name: string | null;
  lastSyncAt: number | null;
  lastError: string | null;
}

export const useTeamStore = create<TeamState>()(
  persist(
    (): TeamState => ({
      hubUrl: "",
      user: null,
      name: null,
      lastSyncAt: null,
      lastError: null,
    }),
    { name: TEAM_STORE_KEY },
  ),
);

syncAcrossWindows(TEAM_STORE_KEY, () => void useTeamStore.persist.rehydrate());
