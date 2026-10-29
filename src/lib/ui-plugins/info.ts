import type { SavedConnection } from "@/lib/connections/types";
import type { DetailedColumnInfo } from "@/lib/db";
import { connectionEnvironment } from "@/lib/environments";
import { tabLabel } from "@/lib/tab-navigation";
import type { Tab } from "@/lib/table-tabs";
import { tabKey } from "@/lib/table-tabs";
import type { ColumnInfo, ConnectionInfo, TabInfo, TableInfo } from "./api";

const connectionCache = new WeakMap<SavedConnection, ConnectionInfo>();

export function connectionInfo(connection: SavedConnection): ConnectionInfo {
  const cached = connectionCache.get(connection);
  if (cached) return cached;
  const info: ConnectionInfo = Object.freeze({
    id: connection.id,
    name: connection.name,
    kind: connection.kind,
    environment: connectionEnvironment(connection),
    tags: Object.freeze((connection.tags ?? []).map((tag) => tag.name)),
    readOnly: !!connection.readOnly,
  });
  connectionCache.set(connection, info);
  return info;
}

export function tableInfo(
  connection: SavedConnection,
  database: string | null | undefined,
  schema: string,
  table: string,
  isView: boolean,
): TableInfo {
  return Object.freeze({
    id: schema ? `${schema}.${table}` : table,
    schema,
    name: table,
    database: database ?? null,
    kind: isView ? "view" : "table",
    connection: connectionInfo(connection),
  });
}

export function columnInfos(
  columns: readonly string[],
  details: readonly DetailedColumnInfo[] | undefined,
): ColumnInfo[] {
  const byName = new Map(details?.map((detail) => [detail.name, detail]));
  return columns.map((name) => {
    const detail = byName.get(name);
    return Object.freeze({
      id: name,
      type: detail?.data_type ?? "",
      label: name,
      primaryKey: detail?.is_primary_key ?? false,
    });
  });
}

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
