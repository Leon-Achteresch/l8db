import { useConnectionsStore } from "@/lib/connections";
import { databaseFromConnectionString, useDbSelectionStore } from "@/lib/db-selection";
import { keyForConnection } from "./tab-keys";
import type { ClosedTab, Tab, TabsState } from "./types";

export function nextQueryTitle(tabs: Tab[]): string {
  const used = new Set(tabs.filter((t) => t.kind === "query").map((t) => t.title));
  let n = 1;
  while (used.has(`Query ${n}`)) n += 1;
  return `Query ${n}`;
}

const MAX_RECENTLY_CLOSED = 100;

export function pushRecentlyClosed(current: ClosedTab[], closed: Tab[]): ClosedTab[] {
  if (closed.length === 0) return current;
  const { connections, activeId } = useConnectionsStore.getState();
  const connection = connections.find((entry) => entry.id === activeId);
  const database = activeId
    ? (useDbSelectionStore.getState().databaseByConnection[activeId] ??
      (connection ? databaseFromConnectionString(connection.connectionString) : null))
    : null;
  return [
    ...closed.map((tab) => ({
      ...tab,
      recoveryId: crypto.randomUUID(),
      closedAt: Date.now(),
      closedConnectionId: activeId,
      closedConnectionName: connection?.name,
      closedDatabase: database,
      ...(tab.kind === "query" ? { autoRun: false } : {}),
    })),
    ...current,
  ].slice(0, MAX_RECENTLY_CLOSED);
}

export function storeFor(
  tabs: Tab[],
  state: { tabsByConnection: Record<string, Tab[]> },
): Pick<TabsState, "tabs" | "tabsByConnection"> {
  return {
    tabs,
    tabsByConnection: {
      ...state.tabsByConnection,
      [keyForConnection(useConnectionsStore.getState().activeId)]: tabs,
    },
  };
}
