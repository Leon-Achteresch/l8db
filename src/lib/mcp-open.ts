import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { useAutoRefreshStore } from "@/lib/auto-refresh";
import { useAiFlashStore } from "@/lib/automation/ai-activity";
import type { SavedConnection } from "@/lib/connections";
import { useConnectionsStore } from "@/lib/connections/store";
import { listForeignKeys } from "@/lib/db";
import { databaseFromConnectionString, useDbSelectionStore } from "@/lib/db-selection";
import { formatPaneSourceKey, masterDetailKey, useMasterDetail } from "@/lib/master-detail";
import { masterDetailRelationSql, masterDetailRelations } from "@/lib/master-detail-relations";
import { capabilitiesFor } from "@/lib/providers";
import { type SplitOrientation, useSplitView } from "@/lib/split-view";
import { activateConnectionWithToast } from "@/lib/ssh/activation";
import { effectiveConnectionString } from "@/lib/ssh/connection-string";
import { navigateToTab, tabLabel } from "@/lib/tab-navigation";
import { type Tab, tabKey, useTableTabs } from "@/lib/table-tabs";
import { tableViewStateKey, useTableViewStateStore } from "@/lib/table-view-state";
import { savedViewKey, useViewsStore, VIEW_COLORS } from "@/lib/views";
import { router } from "@/router";

export interface McpOpenPane {
  schema?: string;
  table?: string;
  filter?: string;
  autoRefresh?: number;
  sql?: string;
  master?: number;
  link?: string;
}

export interface McpOpenRequest extends McpOpenPane {
  connectionId: string;
  database?: string | null;
  saveAs?: string;
  split?: McpOpenPane[];
  orientation?: SplitOrientation;
}

const POLL_MS = 1000;

function openPane(
  pane: McpOpenPane,
  connectionId: string,
  database: string | null,
  flashes: string[],
): Tab | null {
  const tabs = useTableTabs.getState();
  if (pane.sql) {
    const id = tabs.openQueryTabWithSql(pane.sql, "KI-Abfrage");
    return { kind: "query", id, title: "KI-Abfrage", sql: pane.sql };
  }
  if (!pane.schema || !pane.table) return null;
  const { schema, table } = pane;
  tabs.openTab({ schema, table });
  const stateKey = tableViewStateKey(connectionId, database, schema, table);
  if (stateKey && pane.filter !== undefined) {
    useTableViewStateStore.getState().patch(stateKey, {
      filter: pane.filter,
      filterRaw: false,
      filterMode: "sql",
      filterSql: pane.filter,
      filterOpen: pane.filter !== "",
      page: 0,
    });
    flashes.push(`table:${stateKey}`);
  }
  if (stateKey && pane.autoRefresh !== undefined)
    useAutoRefreshStore.getState().setIntervalMs(stateKey, pane.autoRefresh * 1000);
  return { kind: "table", schema, table, entityType: "table" };
}

async function linkSql(
  connection: SavedConnection,
  database: string | null,
  master: Tab,
  detail: Tab,
  link: string | undefined,
): Promise<string> {
  if (link) return link;
  if (master.kind !== "table" || detail.kind !== "table")
    throw new Error("Master-Detail ohne SQL braucht zwei Tabellen.");
  const keys = await listForeignKeys(
    connection.kind,
    effectiveConnectionString(connection),
    master.schema,
    master.table,
    database ?? undefined,
  );
  const relation = masterDetailRelations(keys, master.schema, master.table).find(
    (entry) => entry.schema === detail.schema && entry.table === detail.table,
  );
  if (!relation)
    throw new Error(
      `Keine Fremdschlüssel-Beziehung zwischen ${tabLabel(master)} und ${tabLabel(detail)}.`,
    );
  return masterDetailRelationSql(relation, connection.kind);
}

async function openSplit(
  connection: SavedConnection,
  panes: McpOpenPane[],
  tabs: (Tab | null)[],
  orientation: SplitOrientation | undefined,
): Promise<void> {
  const split = useSplitView.getState();
  split.collapse();
  if (orientation) split.setOrientation(orientation);
  const [first, ...rest] = tabs;
  if (!first) return;
  for (const tab of rest)
    if (tab) useSplitView.getState().split({ activeKey: tabKey(first), key: tabKey(tab) });
  const activeId = useConnectionsStore.getState().activeId;
  const database =
    useDbSelectionStore.getState().databaseByConnection[connection.id] ??
    databaseFromConnectionString(connection.connectionString);
  const sourceKey = (tab: Tab) => formatPaneSourceKey(activeId, tabKey(tab), activeId, database);
  for (const [index, pane] of panes.entries()) {
    const detail = tabs[index];
    const master = pane.master === undefined ? null : tabs[pane.master];
    if (!detail || !master) continue;
    const { panes: keys, setMaster } = useSplitView.getState();
    const detailIndex = keys.indexOf(tabKey(detail));
    const masterIndex = keys.indexOf(tabKey(master));
    if (detailIndex === -1 || masterIndex === -1)
      throw new Error(`${tabLabel(detail)} konnte nicht mit ${tabLabel(master)} verbunden werden.`);
    const sql = await linkSql(
      connection,
      database,
      master,
      detail,
      pane.link ?? (pane.sql?.includes(":master.") ? pane.sql : undefined),
    );
    const key = masterDetailKey(sourceKey(master), sourceKey(detail));
    if (!key) continue;
    useMasterDetail
      .getState()
      .saveScript(key, sql, { master: tabLabel(master), detail: tabLabel(detail) });
    setMaster(detailIndex, masterIndex);
  }
}

export async function applyMcpOpen(request: McpOpenRequest): Promise<void> {
  const connections = useConnectionsStore.getState();
  if (!connections.connections.some((entry) => entry.id === request.connectionId)) return;
  if (
    connections.activeId !== request.connectionId &&
    !(await activateConnectionWithToast(request.connectionId))
  )
    return;
  const connection = useConnectionsStore
    .getState()
    .connections.find((entry) => entry.id === request.connectionId);
  if (!connection) return;
  if (request.database) useDbSelectionStore.getState().setDatabase(connection.id, request.database);
  const database =
    useDbSelectionStore.getState().databaseByConnection[connection.id] ??
    databaseFromConnectionString(connection.connectionString) ??
    (capabilitiesFor(connection.kind).query_language === "redis" ? "0" : null);
  const flashes: string[] = [];
  const panes = [request, ...(request.split ?? [])];
  const opened = panes.map((pane) => openPane(pane, connection.id, database, flashes));
  const tab = opened[0];
  if (!tab) return;
  if (tab.kind === "table" && request.saveAs && request.filter) {
    const viewsKey = savedViewKey(connection.id, database, tab.schema, tab.table);
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
  try {
    if (panes.length > 1) await openSplit(connection, panes, opened, request.orientation);
  } finally {
    await navigateToTab(router.navigate, tab);
    useAiFlashStore
      .getState()
      .flash([...opened.flatMap((entry) => (entry ? [`tab:${tabKey(entry)}`] : [])), ...flashes]);
  }
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
          queue = queue
            .then(() => applyMcpOpen(request))
            .catch((error) => {
              toast.error(error instanceof Error ? error.message : String(error));
            });
      })
      .catch(() => undefined);
  }, POLL_MS);
}
