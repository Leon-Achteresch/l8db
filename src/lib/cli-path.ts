import { create } from "zustand";
import { type CliStatus, cliStatus } from "@/lib/db/cli";
import { syncAcrossWindows } from "@/lib/window-sync";

const CHANGED_KEY = "l8db.cli.path-changed";
const STARTUP_DELAY_MS = 4000;

export function cliNeedsAction(status: CliStatus | null): boolean {
  return status?.state === "missing" || status?.state === "not_on_path";
}

interface CliPathState {
  status: CliStatus | null;
  error: string | null;
  refresh: () => Promise<void>;
  apply: (status: CliStatus) => void;
}

let pending: Promise<void> | null = null;

export const useCliPath = create<CliPathState>((set) => ({
  status: null,
  error: null,
  refresh: () => {
    pending ??= cliStatus()
      .then((status) => set({ status, error: null }))
      .catch((error) => set({ status: null, error: String(error) }))
      .finally(() => {
        pending = null;
      });
    return pending;
  },
  apply: (status) => {
    set({ status, error: null });
    try {
      window.localStorage.setItem(CHANGED_KEY, String(Date.now()));
    } catch {}
  },
}));

export function useCliNeedsAction(): boolean {
  return useCliPath((state) => cliNeedsAction(state.status));
}

export function initCliPathCheck(check: boolean, delayMs = STARTUP_DELAY_MS): () => void {
  const timer = check ? setTimeout(() => void useCliPath.getState().refresh(), delayMs) : undefined;
  const unsync = syncAcrossWindows(CHANGED_KEY, () => void useCliPath.getState().refresh());
  return () => {
    clearTimeout(timer);
    unsync();
  };
}
