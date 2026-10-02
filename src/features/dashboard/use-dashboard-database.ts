import { useEffect, useState } from "react";
import type { Dashboard } from "@/lib/dashboards";
import { dashboardDatabaseSwitch } from "@/lib/dashboards/database";
import { useDbSelectionStore } from "@/lib/db-selection";

export function useDashboardDatabase(
  connectionId: string | null,
  dashboard: Dashboard | null,
  active: string | null,
): boolean {
  const [syncedId, setSyncedId] = useState<string | null>(null);
  const target = dashboardDatabaseSwitch(dashboard, active, syncedId);
  const id = dashboard?.id ?? null;
  useEffect(() => {
    if (!connectionId || !id || id === syncedId) return;
    if (target) useDbSelectionStore.getState().setDatabase(connectionId, target);
    setSyncedId(id);
  }, [connectionId, id, syncedId, target]);
  return Boolean(id && id !== syncedId && target);
}
