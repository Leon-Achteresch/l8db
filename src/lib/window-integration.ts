import { isTauri } from "@tauri-apps/api/core";
import {
  type SavedConnection,
  sortConnectionsByName,
  useConnectionsStore,
} from "@/lib/connections";
import { type DockEntry, setDockRecents, setWindowConnection } from "@/lib/db";

export const DOCK_CONNECTION_LIMIT = 8;

export function dockEntries(connections: SavedConnection[], recentIds: string[]): DockEntry[] {
  const saved = connections.filter((connection) => !connection.temporary);
  const byId = new Map(saved.map((connection) => [connection.id, connection]));
  const recent = recentIds.flatMap((id) => byId.get(id) ?? []);
  const rest = sortConnectionsByName(
    saved.filter((connection) => !recentIds.includes(connection.id)),
  );
  return [...recent, ...rest].slice(0, DOCK_CONNECTION_LIMIT).map(({ id, name }) => ({ id, name }));
}

export function initWindowIntegration(): () => void {
  if (!isTauri()) return () => undefined;
  let dockKey = "";
  let activeId: string | null | undefined;
  const publish = () => {
    const state = useConnectionsStore.getState();
    if (state.activeId !== activeId) {
      activeId = state.activeId;
      void setWindowConnection(activeId).catch(() => undefined);
    }
    const entries = dockEntries(state.connections, state.recentIds);
    const key = JSON.stringify(entries);
    if (key === dockKey) return;
    dockKey = key;
    void setDockRecents(entries).catch(() => undefined);
  };
  publish();
  return useConnectionsStore.subscribe(publish);
}
