import { useSyncExternalStore } from "react";
import { usageStatisticsStore } from "@/lib/usage-statistics";

export function useUsageStatistics() {
  return useSyncExternalStore(
    usageStatisticsStore.subscribe,
    usageStatisticsStore.getSnapshot,
    usageStatisticsStore.getSnapshot,
  );
}
