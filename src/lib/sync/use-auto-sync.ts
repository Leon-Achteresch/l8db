import { useEffect } from "react";
import { syncClaimLeader, syncReleaseLeader } from "@/lib/db/sync";
import { autoSyncPlan, startAutoSync } from "./auto-sync";
import { autoDecider, performSync } from "./controller";
import { syncTarget, useSyncStore } from "./store";

let startConsumed = false;

export function useAutoSync(): void {
  const autoSync = useSyncStore((state) => state.autoSync);
  const configured = useSyncStore((state) => syncTarget(state) !== null);
  const intervalMinutes = useSyncStore((state) => state.intervalMinutes);
  const syncOnStart = useSyncStore((state) => state.syncOnStart);
  useEffect(() => {
    const plan = autoSyncPlan({ autoSync, configured, intervalMinutes });
    if (!plan) return;
    const onStart = syncOnStart && !startConsumed;
    startConsumed = true;
    return startAutoSync({
      intervalMs: plan.intervalMs,
      syncOnStart: onStart,
      claim: syncClaimLeader,
      release: syncReleaseLeader,
      run: async (signal) => {
        await performSync("sync", autoDecider, signal);
      },
    });
  }, [autoSync, configured, intervalMinutes, syncOnStart]);
}
