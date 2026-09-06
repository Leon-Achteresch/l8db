import { toast } from "sonner";
import { useConnectionsStore } from "@/lib/connections";
import { databaseFromConnectionString, useDbSelectionStore } from "@/lib/db-selection";
import { version } from "../../../package.json";
import type { DatabaseInfo } from "./contracts";
import { ExtensionManager } from "./manager";
import { SandboxRuntime } from "./sandbox-runtime";
import { TauriExtensionStorage } from "./tauri-storage";

export function createExtensionHost() {
  const database = (): DatabaseInfo | null => {
    const state = useConnectionsStore.getState();
    const connection = state.connections.find(c => c.id === state.activeId);
    if (!connection) return null;
    return { connectionId: connection.id, name: useDbSelectionStore.getState().databaseByConnection[connection.id] ?? databaseFromConnectionString(connection.connectionString) ?? connection.name, kind: connection.kind };
  };
  const manager = new ExtensionManager(new TauriExtensionStorage(), new SandboxRuntime(), { database, notify: message => toast.info(message) }, version);
  let dispose: (() => void) | undefined;
  return {
    manager,
    async start() {
      if (dispose) return;
      await manager.discover();
      let previous: DatabaseInfo | null = null;
      let transitions = Promise.resolve();
      const update = () => {
        const current = database();
        if (JSON.stringify(current) === JSON.stringify(previous)) return;
        const closed = previous;
        previous = current;
        transitions = transitions.then(async () => {
          if (closed) manager.events.emit("databaseClosed", closed);
          if (current) { await manager.trigger("onDatabaseOpen"); manager.events.emit("databaseOpened", current) }
        }).catch(error => manager.log("host", "error", String(error)));
      };
      const connections = useConnectionsStore.subscribe(update);
      const selections = useDbSelectionStore.subscribe(update);
      dispose = () => { connections(); selections() };
      await manager.trigger("onStartup");
      update();
    },
    dispose() { dispose?.(); dispose = undefined },
  };
}
