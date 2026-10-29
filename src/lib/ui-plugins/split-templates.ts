import { useConnectionsStore } from "@/lib/connections";
import type { SavedConnection } from "@/lib/connections/types";
import { databaseFromConnectionString, useDbSelectionStore } from "@/lib/db-selection";
import { formatPaneSourceKey, masterDetailKey, useMasterDetail } from "@/lib/master-detail";
import { masterDetailRelationSql } from "@/lib/master-detail-relations";
import { type SplitGroup, useSplitView } from "@/lib/split-view";
import { type Tab, type TableTab, tabKey } from "@/lib/table-tabs";
import type { Template } from "./api";
import type { TemplateEntry } from "./registry";

function list(value: string | readonly string[] | undefined): readonly string[] {
  return value === undefined ? [] : typeof value === "string" ? [value] : value;
}

function globMatches(pattern: string, value: string) {
  const source = pattern
    .toLowerCase()
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${source}$`).test(value.toLowerCase());
}

export function templateMatches(template: Template, connection: SavedConnection | undefined) {
  if (!template.when) return true;
  if (!connection) return false;
  const tags = list(template.when.connectionTag);
  const names = list(template.when.connectionName);
  const ownTags = (connection.tags ?? []).map((tag) => tag.name.toLowerCase());
  return (
    (tags.length === 0 || tags.some((tag) => ownTags.includes(tag.toLowerCase()))) &&
    (names.length === 0 || names.some((name) => globMatches(name, connection.name)))
  );
}

export function templateTabs(template: Template): TableTab[] {
  return template.panes.map((pane) => {
    const dot = pane.table.indexOf(".");
    return {
      kind: "table",
      schema: pane.table.slice(0, dot),
      table: pane.table.slice(dot + 1),
      entityType: "table",
    };
  });
}

export function templateGroupId(entry: TemplateEntry) {
  return `tpl:${entry.key}`;
}

export function openTemplate(entry: TemplateEntry): Tab | null {
  const { activeId, connections } = useConnectionsStore.getState();
  const connection = connections.find((item) => item.id === activeId);
  if (!activeId || !connection) return null;
  const { template } = entry;
  const tabs = templateTabs(template);
  const database =
    useDbSelectionStore.getState().databaseByConnection[activeId] ??
    databaseFromConnectionString(connection.connectionString);
  const sourceKey = (tab: Tab) => formatPaneSourceKey(activeId, tabKey(tab), activeId, database);
  template.panes.forEach((pane, index) => {
    if (!pane.link || pane.master === undefined) return;
    const master = tabs[pane.master];
    const detail = tabs[index];
    const key = masterDetailKey(sourceKey(master), sourceKey(detail));
    if (!key || useMasterDetail.getState().scripts[key] !== undefined) return;
    const sql = masterDetailRelationSql(
      {
        id: "template",
        constraint: "",
        direction: "child",
        schema: detail.schema,
        table: detail.table,
        columns: [{ source: pane.link.masterColumn ?? pane.link.column, target: pane.link.column }],
      },
      connection.kind,
    );
    useMasterDetail.getState().saveScript(key, sql, {
      master: template.panes[pane.master].table,
      detail: pane.table,
    });
  });
  const id = templateGroupId(entry);
  const group: SplitGroup = {
    id,
    name: template.name,
    tabs,
    masters: template.panes.map((pane) => pane.master ?? null),
    orientation: template.orientation ?? "horizontal",
    focusedPane: 0,
  };
  useSplitView.setState((state) => ({
    groups: {
      ...state.groups,
      [activeId]: [...(state.groups[activeId] ?? []).filter((item) => item.id !== id), group],
    },
  }));
  return useSplitView.getState().openGroup(id);
}
