import type { Tab, TableTab } from "./types";

const REMOTE_PREFIX = "remote:";

export function tabKey(tab: Tab): string {
  if (tab.kind === "table")
    return tab.connectionId
      ? `${REMOTE_PREFIX}${JSON.stringify([tab.connectionId, tab.schema, tab.table, tab.entityType ?? "table"])}`
      : `table:${tab.schema}.${tab.table}`;
  if (tab.kind === "query") return `query:${tab.id}`;
  if (tab.kind === "function") return `function:${tab.oid}`;
  if (tab.kind === "procedure") return `procedure:${tab.oid}`;
  if (tab.kind === "role") return `role:${tab.name}`;
  if (tab.kind === "trigger") return `trigger:${tab.schema}.${tab.table}.${tab.trigger}`;
  if (tab.kind === "view-editor") return `view-editor:${tab.schema}.${tab.view}`;
  if (tab.kind === "alter-table") return `alter-table:${tab.schema}.${tab.table}`;
  if (tab.kind === "package") return `package:${tab.schema}.${tab.name}`;
  if (tab.kind === "bucket") return `bucket:${tab.bucket}`;
  if (tab.kind === "tool") return `tool:${tab.tool}${tab.id ? `:${tab.id}` : ""}`;
  if (tab.kind === "extension-panel") return `extension-panel:${tab.extensionId}:${tab.panelId}`;
  return `extension:${tab.name}`;
}

export function remoteTableTab(key: string | null | undefined): TableTab | null {
  if (!key?.startsWith(REMOTE_PREFIX)) return null;
  try {
    const [connectionId, schema, table, entityType] = JSON.parse(key.slice(REMOTE_PREFIX.length));
    return { kind: "table", schema, table, entityType, connectionId };
  } catch {
    return null;
  }
}

const NONE_KEY = "__none__";

export function keyForConnection(id: string | null | undefined): string {
  return id ?? NONE_KEY;
}

export function readPersistedActiveConnectionId(): string | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    const raw = window.localStorage.getItem("l8db.connections");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { state?: { activeId?: string | null } };
    return parsed?.state?.activeId ?? null;
  } catch {
    return null;
  }
}
