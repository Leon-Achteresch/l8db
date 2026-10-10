import { invoke } from "@tauri-apps/api/core";
import { validateDashboardDesign } from "@/lib/dashboard-design";
import { confirmExpertSql, dashboardSqlParts, sanitizePages } from "@/lib/dashboard-file";
import type { Dashboard } from "./model";
import { useDashboardsStore, withoutDashboardHistory } from "./store";
import { sanitizeTheme } from "./theme";

type Content = Pick<
  Dashboard,
  "name" | "datasets" | "widgets" | "refreshSec" | "variables" | "design" | "pages" | "theme"
>;

export interface McpDashboardFile extends Omit<Content, "design"> {
  design?: Dashboard["design"] | null;
  id: string;
  connectionId: string;
  stamp: string;
  trusted?: boolean;
}

const WRITE_DELAY_MS = 400;
const POLL_MS = 2000;
const synced = new Map<string, string>();
const pending = new Map<string, ReturnType<typeof setTimeout>>();
const dropping = new Set<string>();
const declined = new Map<string, string>();

function expertSql(dashboard: Pick<Dashboard, "datasets" | "variables">): string {
  return JSON.stringify(dashboardSqlParts(dashboard).sort());
}

function approved(file: McpDashboardFile, current: Dashboard | undefined): boolean {
  if (file.trusted === true) return true;
  if (current && expertSql(current) === expertSql(file)) return true;
  if (declined.get(file.id) === file.stamp) return false;
  if (confirmExpertSql({ ...file, design: file.design ?? undefined, locked: true })) {
    declined.delete(file.id);
    return true;
  }
  declined.set(file.id, file.stamp);
  return false;
}

function content(dashboard: Content): string {
  return JSON.stringify([
    dashboard.name,
    dashboard.datasets,
    dashboard.widgets,
    dashboard.refreshSec,
    dashboard.variables ?? [],
    dashboard.design ?? null,
    dashboard.pages ?? [],
    dashboard.theme ?? null,
  ]);
}

export function applyMcpDashboards(files: McpDashboardFile[]): void {
  const store = useDashboardsStore.getState();
  for (const file of files) {
    const current = useDashboardsStore.getState().dashboards.find((d) => d.mcpId === file.id);
    if (current?.mcpStamp === file.stamp) {
      if (!synced.has(file.id)) synced.set(file.id, content(current));
      continue;
    }
    if (pending.has(file.id)) continue;
    try {
      if (file.design != null) validateDashboardDesign(file.design);
    } catch {
      continue;
    }
    let theme: Dashboard["theme"] = null;
    try {
      theme = sanitizeTheme(file.theme);
    } catch {
      theme = current?.theme ?? null;
    }
    if (!approved(file, current)) continue;
    const next = {
      name: file.name,
      datasets: file.datasets,
      widgets: file.widgets,
      variables: file.variables ?? [],
      refreshSec: file.refreshSec ?? 0,
      design: file.design ?? undefined,
      pages: sanitizePages(file.pages),
      theme,
      mcpStamp: file.stamp,
    };
    synced.set(file.id, content(next));
    withoutDashboardHistory(() => {
      if (current) {
        store.update(current.id, next);
        store.setActive(current.connectionId, current.id);
      } else {
        store.importDashboard({ ...next, mcpId: file.id, locked: true }, file.connectionId, null);
      }
    });
  }
  const ids = new Set(files.map((file) => file.id));
  for (const dashboard of useDashboardsStore.getState().dashboards) {
    if (!dashboard.mcpId || ids.has(dashboard.mcpId) || pending.has(dashboard.mcpId)) continue;
    synced.delete(dashboard.mcpId);
    dropping.add(dashboard.mcpId);
    withoutDashboardHistory(() => store.remove(dashboard.id));
    dropping.delete(dashboard.mcpId);
  }
}

async function writeBack(mcpId: string): Promise<void> {
  const dashboard = useDashboardsStore.getState().dashboards.find((d) => d.mcpId === mcpId);
  if (!dashboard) return;
  const next = content(dashboard);
  if (synced.get(mcpId) === next) return;
  synced.set(mcpId, next);
  try {
    const stamp = await invoke<string>("mcp_dashboard_save", {
      dashboard: {
        id: mcpId,
        connectionId: dashboard.connectionId,
        name: dashboard.name,
        datasets: dashboard.datasets,
        widgets: dashboard.widgets,
        ...(dashboard.variables?.length ? { variables: dashboard.variables } : {}),
        refreshSec: dashboard.refreshSec,
        ...(dashboard.design ? { design: dashboard.design } : {}),
        ...(dashboard.pages?.length ? { pages: dashboard.pages } : {}),
        ...(dashboard.theme ? { theme: dashboard.theme } : {}),
      },
    });
    useDashboardsStore.getState().update(dashboard.id, { mcpStamp: stamp });
  } catch {
    synced.delete(mcpId);
  }
}

function scheduleWrite(mcpId: string): void {
  clearTimeout(pending.get(mcpId));
  pending.set(
    mcpId,
    setTimeout(() => {
      pending.delete(mcpId);
      void writeBack(mcpId);
    }, WRITE_DELAY_MS),
  );
}

export function trackMcpEdits(dashboards: Dashboard[], previous: Dashboard[]): void {
  if (dashboards === previous) return;
  for (const dashboard of dashboards) {
    if (!dashboard.mcpId || previous.includes(dashboard)) continue;
    if (synced.get(dashboard.mcpId) !== content(dashboard)) scheduleWrite(dashboard.mcpId);
  }
  for (const dashboard of previous) {
    const id = dashboard.mcpId;
    if (!id || dropping.has(id) || dashboards.some((d) => d.mcpId === id)) continue;
    synced.delete(id);
    clearTimeout(pending.get(id));
    pending.delete(id);
    void invoke("mcp_dashboard_delete", { id }).catch(() => undefined);
  }
}

export function pollMcpDashboards(): Promise<void> {
  return invoke<McpDashboardFile[]>("mcp_dashboards")
    .then(applyMcpDashboards)
    .catch(() => undefined);
}

let started = false;

export function initMcpDashboardSync(): void {
  if (started) return;
  started = true;
  useDashboardsStore.subscribe((state, prev) => trackMcpEdits(state.dashboards, prev.dashboards));
  const poll = () => {
    if (document.visibilityState === "visible") void pollMcpDashboards();
  };
  poll();
  setInterval(poll, POLL_MS);
  window.addEventListener("focus", poll);
}
