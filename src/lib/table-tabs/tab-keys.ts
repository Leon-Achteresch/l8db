import type { Tab } from "./types";

export function tabKey(tab: Tab): string {
  if (tab.kind === "table") return `table:${tab.schema}.${tab.table}`;
  if (tab.kind === "query") return `query:${tab.id}`;
  if (tab.kind === "function") return `function:${tab.oid}`;
  if (tab.kind === "procedure") return `procedure:${tab.oid}`;
  if (tab.kind === "role") return `role:${tab.name}`;
  if (tab.kind === "trigger") return `trigger:${tab.schema}.${tab.table}.${tab.trigger}`;
  if (tab.kind === "view-editor") return `view-editor:${tab.schema}.${tab.view}`;
  if (tab.kind === "alter-table") return `alter-table:${tab.schema}.${tab.table}`;
  if (tab.kind === "package") return `package:${tab.schema}.${tab.name}`;
  if (tab.kind === "tool") return `tool:${tab.tool}`;
  if (tab.kind === "extension-panel") return `extension-panel:${tab.extensionId}:${tab.panelId}`;
  return `extension:${tab.name}`;
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
