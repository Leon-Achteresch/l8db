import { toast } from "sonner";
import { create } from "zustand";
import { copyText, pasteText } from "@/lib/clipboard";
import type { SavedConnection } from "@/lib/connections";
import { useConnectionsStore } from "@/lib/connections/store";
import { databaseFromConnectionString, useDbSelectionStore } from "@/lib/db-selection";
import { IS_MAC } from "@/lib/platform";
import { capabilitiesFor } from "@/lib/providers";
import {
  connectionRef,
  containsSharedTabLink,
  effectiveSharedView,
  MAX_OS_SHARED_TAB_LINK,
  parseSharedTabLink,
  resolveSharedConnection,
  type SharedTab,
  sharedTabLink,
  sharedViewOf,
} from "@/lib/shared-tabs";
import { activateConnectionWithToast } from "@/lib/ssh/activation";
import { navigateToTab, tabLabel } from "@/lib/tab-navigation";
import type { Tab } from "@/lib/table-tabs";
import { useTableTabs } from "@/lib/table-tabs";
import { tableViewStateKey, useTableViewStateStore } from "@/lib/table-view-state";
import { router } from "@/router";

export function connectionDatabase(connection: SavedConnection): string | null {
  return (
    useDbSelectionStore.getState().databaseByConnection[connection.id] ??
    databaseFromConnectionString(connection.connectionString) ??
    (capabilitiesFor(connection.kind).query_language === "redis" ? "0" : null)
  );
}

export function captureSharedTab(tab: Tab): SharedTab | null {
  const connections = useConnectionsStore.getState();
  const id = tab.connectionId ?? connections.activeId;
  const connection = connections.connections.find((entry) => entry.id === id);
  if (!connection) return null;
  const database = connectionDatabase(connection);
  const base = { v: 1 as const, connection: connectionRef(connection), database };
  if (tab.kind === "query") return { ...base, kind: "query", title: tabLabel(tab), sql: tab.sql };
  if (tab.kind !== "table") return null;
  const key = tableViewStateKey(connection.id, database, tab.schema, tab.table);
  const view = key ? useTableViewStateStore.getState().views[key] : undefined;
  return {
    ...base,
    kind: "table",
    schema: tab.schema,
    table: tab.table,
    entityType: tab.entityType ?? "table",
    view: sharedViewOf(view),
  };
}

export async function openSharedTab(shared: SharedTab, connectionId: string): Promise<boolean> {
  const connections = useConnectionsStore.getState();
  if (!connections.connections.some((entry) => entry.id === connectionId)) return false;
  if (connections.activeId !== connectionId && !(await activateConnectionWithToast(connectionId)))
    return false;
  const connection = useConnectionsStore
    .getState()
    .connections.find((entry) => entry.id === connectionId);
  if (!connection) return false;
  if (
    shared.database &&
    connection.kind === shared.connection.kind &&
    shared.database !== connectionDatabase(connection)
  )
    useDbSelectionStore.getState().setDatabase(connection.id, shared.database);
  const tabs = useTableTabs.getState();
  if (shared.kind === "query") {
    const id = tabs.openQueryTabWithSql(shared.sql, shared.title);
    await navigateToTab(router.navigate, {
      kind: "query",
      id,
      title: shared.title,
      sql: shared.sql,
    });
    return true;
  }
  const { schema, table, entityType } = shared;
  const view = effectiveSharedView(shared.view);
  tabs.openTab({ schema, table, entityType });
  const key = tableViewStateKey(connection.id, connectionDatabase(connection), schema, table);
  if (key)
    useTableViewStateStore.getState().patch(key, {
      filter: "",
      filterRaw: false,
      filterMode: "simple",
      filterSql: "",
      filterConditions: [],
      filterCombinator: "AND",
      sorting: [],
      ...view,
      filterOpen: Boolean(view.filter || view.filterConditions?.length),
      page: 0,
    });
  await navigateToTab(router.navigate, { kind: "table", schema, table, entityType });
  return true;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function openSharedTabWithToast(tab: SharedTab, connectionId: string): void {
  openSharedTab(tab, connectionId).catch((error) => toast.error(errorText(error)));
}

const PASTE_KEY = IS_MAC ? "⌘V" : "Strg+V";

export async function copySharedTabLink(tab: SharedTab): Promise<void> {
  try {
    const link = await sharedTabLink(tab);
    await copyText(link, `Link kopiert · öffnen mit ${PASTE_KEY} in l8db`);
    if (link.length > MAX_OS_SHARED_TAB_LINK)
      toast.warning("Link ist zu lang zum Anklicken", {
        description: `Nur in l8db mit ${PASTE_KEY} öffnen`,
      });
  } catch (error) {
    toast.error(errorText(error));
  }
}

interface PendingSharedTab {
  tab: SharedTab;
  source: "link" | "saved";
}

export const useSharedTabRequest = create<{
  pending: PendingSharedTab | null;
  close: () => void;
}>()((set) => ({ pending: null, close: () => set({ pending: null }) }));

export function requestSharedTab(tab: SharedTab, source: PendingSharedTab["source"]): void {
  if (source === "saved") {
    const target = resolveSharedConnection(
      tab.connection,
      useConnectionsStore.getState().connections,
    );
    if (target.certain && target.id) {
      openSharedTabWithToast(tab, target.id);
      return;
    }
  }
  useSharedTabRequest.setState({ pending: { tab, source } });
}

export async function openSharedTabLinkText(text: string): Promise<boolean> {
  const shared = await parseSharedTabLink(text);
  if (shared) requestSharedTab(shared, "link");
  else toast.error("Ungültiger l8db-Link");
  return shared !== null;
}

export async function openLinkFromClipboard(): Promise<void> {
  const text = await pasteText().catch(() => "");
  if (containsSharedTabLink(text)) await openSharedTabLinkText(text);
  else toast.error("Kein l8db-Link in der Zwischenablage");
}
