import { invoke } from "@tauri-apps/api/core";
import { useAiFlashStore } from "@/lib/automation/ai-activity";
import { useConnectionsStore } from "@/lib/connections/store";
import { databaseFromConnectionString, useDbSelectionStore } from "@/lib/db-selection";
import { activateConnectionWithToast } from "@/lib/ssh/activation";
import { navigateToTab } from "@/lib/tab-navigation";
import { type Tab, tabKey, useTableTabs } from "@/lib/table-tabs";
import { tableViewStateKey, useTableViewStateStore } from "@/lib/table-view-state";
import { savedViewKey, useViewsStore, VIEW_COLORS } from "@/lib/views";
import { router } from "@/router";

export interface McpOpenRequest {
  connectionId: string;
  database?: string | null;
  schema?: string;
  table?: string;
  filter?: string;
  saveAs?: string;
  sql?: string;
}

const POLL_MS = 1000;

export async function applyMcpOpen(request: McpOpenRequest): Promise<void> {
  const connections = useConnectionsStore.getState();
  const connection = connections.connections.find((entry) => entry.id === request.connectionId);
  if (!connection) return;
  if (connections.activeId !== connection.id && !(await activateConnectionWithToast(connection.id)))
    return;
  if (request.database) useDbSelectionStore.getState().setDatabase(connection.id, request.database);
  const tabs = useTableTabs.getState();
  let tab: Tab;
  const flashes: string[] = [];
  if (request.sql) {
    const id = tabs.openQueryTabWithSql(request.sql, "KI-Abfrage");
    tab = { kind: "query", id, title: "KI-Abfrage", sql: request.sql };
  } else if (request.schema && request.table) {
    const { schema, table } = request;
    tabs.openTab({ schema, table });
    tab = { kind: "table", schema, table, entityType: "table" };
    const database =
      useDbSelectionStore.getState().databaseByConnection[connection.id] ??
      databaseFromConnectionString(connection.connectionString);
    const stateKey = tableViewStateKey(connection.id, database, schema, table);
    if (stateKey && request.filter !== undefined) {
      useTableViewStateStore.getState().patch(stateKey, {
        filter: request.filter,
        filterRaw: false,
        filterMode: "sql",
        filterSql: request.filter,
        filterOpen: request.filter !== "",
        page: 0,
      });
      flashes.push(`table:${stateKey}`);
    }
    if (request.saveAs && request.filter) {
      const viewsKey = savedViewKey(connection.id, database, schema, table);
      const views = useViewsStore.getState();
      const existing = views.views[viewsKey] ?? [];
      for (const view of existing)
        if (view.name === request.saveAs) views.removeView(viewsKey, view.id);
      views.addView(viewsKey, {
        name: request.saveAs,
        filter: request.filter,
        filterRaw: false,
        color: VIEW_COLORS[existing.length % VIEW_COLORS.length],
      });
    }
  } else return;
  await navigateToTab(router.navigate, tab);
  useAiFlashStore.getState().flash([`tab:${tabKey(tab)}`, ...flashes]);
}

let started = false;
let queue = Promise.resolve();

export function initMcpOpen(): void {
  if (started) return;
  started = true;
  setInterval(() => {
    void invoke<McpOpenRequest[]>("mcp_take_open_requests")
      .then((requests) => {
        for (const request of requests)
          queue = queue.then(() => applyMcpOpen(request)).catch(() => undefined);
      })
      .catch(() => undefined);
  }, POLL_MS);
}
