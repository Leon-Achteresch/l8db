import {
  type QueryWorkspaceOptions,
  sanitizeWorkspace,
  useQueryWorkspace,
} from "@/lib/query-workspace";
import { type Tab, tabKey, useTableTabs } from "@/lib/table-tabs";
import {
  type TableViewState,
  tableViewStateKey,
  useTableViewStateStore,
} from "@/lib/table-view-state";
import { saveWorkbenchRecord } from "./records";

export interface Investigation {
  note: string;
  tabs: (
    | { kind: "query"; title: string; sql: string; key: string }
    | {
        kind: "table";
        schema: string;
        table: string;
        entityType?: "table" | "view";
        key: string;
        view?: Partial<TableViewState>;
      }
  )[];
  activeKey: string | null;
  workspace: Partial<QueryWorkspaceOptions>;
}
export function captureInvestigation(
  connectionId: string,
  database: string | null,
  activeKey: string | null,
  note: string,
): Investigation {
  const tabs = useTableTabs
    .getState()
    .tabs.filter(
      (tab) =>
        (!tab.connectionId || tab.connectionId === connectionId) &&
        (tab.kind === "query" || tab.kind === "table"),
    );
  if (!tabs.length) throw new Error("Öffne zuerst eine Abfrage oder Tabelle.");
  if (tabs.length > 50)
    throw new Error("Ein Arbeitsstand umfasst höchstens 50 Abfragen und Tabellen.");
  if (note.length > 10_000) throw new Error("Die Notiz darf höchstens 10.000 Zeichen enthalten.");
  return {
    note,
    activeKey,
    workspace: sanitizeWorkspace(useQueryWorkspace.getState()),
    tabs: tabs.flatMap((tab): Investigation["tabs"] => {
      if (tab.kind === "query")
        return [{ kind: "query", title: tab.title, sql: tab.sql, key: tabKey(tab) }];
      if (tab.kind !== "table") return [];
      const key = tableViewStateKey(connectionId, database, tab.schema, tab.table);
      const view = key ? useTableViewStateStore.getState().views[key] : undefined;
      return [
        {
          kind: "table",
          schema: tab.schema,
          table: tab.table,
          entityType: tab.entityType,
          key: tabKey(tab),
          view: view ? { ...view, page: 0, scroll: undefined } : undefined,
        },
      ];
    }),
  };
}
export function saveInvestigation(scope: string, name: string, value: Investigation, id?: string) {
  return saveWorkbenchRecord({ id, kind: "investigation", scope, name, value });
}
export function restoreInvestigation(
  connectionId: string,
  database: string | null,
  value: Investigation,
): Tab | null {
  const state = useTableTabs.getState();
  let active: Tab | null = null;
  for (const entry of value.tabs) {
    let tab: Tab;
    if (entry.kind === "query") {
      const id = state.openQueryTabWithSql(entry.sql, entry.title, false);
      tab = { kind: "query", id, title: entry.title, sql: entry.sql };
    } else {
      state.openTab(entry);
      const viewKey = tableViewStateKey(connectionId, database, entry.schema, entry.table);
      if (entry.view && viewKey) useTableViewStateStore.getState().patch(viewKey, entry.view);
      tab = {
        kind: "table",
        schema: entry.schema,
        table: entry.table,
        entityType: entry.entityType,
      };
    }
    if (!active || entry.key === value.activeKey) active = tab;
  }
  useQueryWorkspace.getState().update(sanitizeWorkspace(value.workspace));
  return active;
}
