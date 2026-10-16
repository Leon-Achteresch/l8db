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
  managedHub: string | null;
  promptOpen: boolean;
}

export const useTeamStore = create<TeamState>()(
  persist(
    (): TeamState => ({
      hubUrl: "",
      user: null,
      name: null,
      lastSyncAt: null,
      lastError: null,
      managedHub: null,
      promptOpen: false,
    }),
    {
      name: TEAM_STORE_KEY,
      partialize: ({ managedHub: _managed, promptOpen: _prompt, ...persisted }) => persisted,
    },
  ),
);

syncAcrossWindows(TEAM_STORE_KEY, () => void useTeamStore.persist.rehydrate());
