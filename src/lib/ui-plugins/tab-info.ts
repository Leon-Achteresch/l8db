import type { SavedConnection } from "@/lib/connections/types";
import { tabLabel } from "@/lib/tab-navigation";
import { type Tab, tabKey } from "@/lib/table-tabs";
import type { TabInfo } from "./api";
import { connectionInfo, tableInfo } from "./info";

export function tabInfo(tab: Tab, connection: SavedConnection | null | undefined): TabInfo {
  const info = connection ? connectionInfo(connection) : null;
  const kind =
    tab.kind === "table"
      ? (tab.entityType ?? "table") === "view"
        ? "view"
        : "table"
      : tab.kind === "query"
        ? "query"
        : "other";
  return {
    key: tabKey(tab),
    kind,
    title: tabLabel(tab),
    connection: info,
    table:
      tab.kind === "table" && connection
        ? tableInfo(connection, null, tab.schema, tab.table, kind === "view")
        : null,
  };
}
