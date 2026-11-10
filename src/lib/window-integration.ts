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

export const DOCK_PUBLISH_DELAY_MS = 1000;

export function initWindowIntegration(dockDelayMs = DOCK_PUBLISH_DELAY_MS): () => void {
  if (!isTauri()) return () => undefined;
  let dockKey = "";
  let dockTimer: ReturnType<typeof setTimeout> | undefined;
  let activeId: string | null | undefined;
  const publishDock = () => {
    dockTimer = undefined;
    const state = useConnectionsStore.getState();
    const entries = dockEntries(state.connections, state.recentIds);
    const key = JSON.stringify(entries);
    if (key === dockKey) return;
    dockKey = key;
    void setDockRecents(entries).catch(() => undefined);
  };
  const publish = () => {
    const state = useConnectionsStore.getState();
    if (state.activeId !== activeId) {
      activeId = state.activeId;
      void setWindowConnection(activeId).catch(() => undefined);
    }
    dockTimer ??= setTimeout(publishDock, dockDelayMs);
  };
  const flush = () => {
    if (dockTimer === undefined) return;
    clearTimeout(dockTimer);
    publishDock();
  };
  publish();
  const unsubscribe = useConnectionsStore.subscribe(publish);
  window.addEventListener("pagehide", flush);
  return () => {
    unsubscribe();
    window.removeEventListener("pagehide", flush);
    clearTimeout(dockTimer);
  };
}
