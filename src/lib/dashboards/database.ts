import type { Dashboard } from "./model";

export function dashboardDatabaseSwitch(
  dashboard: Pick<Dashboard, "id" | "database"> | null,
  active: string | null,
  syncedId: string | null,
): string | null {
  if (!dashboard?.database || dashboard.id === syncedId) return null;
  return dashboard.database === active ? null : dashboard.database;
}
