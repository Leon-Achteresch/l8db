import { invoke } from "@tauri-apps/api/core";
import type { Dashboard } from "@/lib/dashboards/model";

export async function saveDashboardForDesignAi(dashboard: Dashboard): Promise<string> {
  return invoke<string>("mcp_dashboard_save", {
    dashboard: {
      id: dashboard.mcpId ?? dashboard.id,
      connectionId: dashboard.connectionId,
      name: dashboard.name,
      datasets: dashboard.datasets,
      widgets: dashboard.widgets,
      variables: dashboard.variables ?? [],
      refreshSec: dashboard.refreshSec,
      design: dashboard.design,
      pages: dashboard.pages ?? [],
      theme: dashboard.theme ?? null,
    },
  });
}
