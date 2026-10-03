import { splitSecretParams, withSecretParams } from "@/lib/connection-export/export";
import { sslModeFromUrl } from "@/lib/connection-url";
import { capabilitiesFor } from "@/lib/providers";
import { extractUrlPassword, injectUrlPassword, loadSecret, storeSecret } from "@/lib/secrets";
import { loadQuerySecret, markQuerySecretResolved, useConnectionsStore } from "./store";
import type { SavedConnection } from "./types";

let secretsInitialized = false;

export async function initConnectionSecrets(): Promise<void> {
  if (secretsInitialized) return;
  secretsInitialized = true;
  const { connections } = useConnectionsStore.getState();
  if (connections.length === 0) return;
  let changed = false;
  let plaintextParams = false;
  const next = await Promise.all(
    connections.map((connection) =>
      (async () => {
        const inlineParams = splitSecretParams(connection.connectionString).secrets;
        if (inlineParams) plaintextParams = true;
        const params = inlineParams ? null : await loadQuerySecret(connection);
        if (params) changed = true;
        const withDefaults: SavedConnection = {
          ssh: null,
          ...connection,
          connectionString: withSecretParams(connection.connectionString, params),
          sslMode: connection.sslMode ?? sslModeFromUrl(connection.connectionString),
        };
        if (withDefaults.sslMode !== connection.sslMode || withDefaults.ssh !== connection.ssh) {
          changed = true;
        }
        const inline = extractUrlPassword(withDefaults.connectionString);
        if (inline) {
          changed = true;
          try {
            await storeSecret(withDefaults.id, inline);
          } catch {
            return withDefaults;
          }
          return withDefaults;
        }
        try {
          const saved = await loadSecret(withDefaults.id);
          if (saved) {
            changed = true;
            return {
              ...withDefaults,
              connectionString: injectUrlPassword(withDefaults.connectionString, saved),
            };
          }
        } catch {
          return withDefaults;
        }
        return withDefaults;
      })(),
    ),
  );
  if (changed) {
    const originals = new Map(connections.map((connection) => [connection.id, connection]));
    const initialized = new Map(next.map((connection) => [connection.id, connection]));
    useConnectionsStore.setState((state) => {
      let hasUpdates = false;
      const connections = state.connections.map((connection) => {
        const original = originals.get(connection.id);
        const restored = initialized.get(connection.id);
        if (!original || !restored) return connection;
        const sslMode = connection.sslMode ?? restored.sslMode;
        const ssh = connection.ssh ?? restored.ssh;
        const connectionString =
          connection.connectionString === original.connectionString
            ? restored.connectionString
            : connection.connectionString;
        if (
          sslMode === connection.sslMode &&
          ssh === connection.ssh &&
          connectionString === connection.connectionString
        )
          return connection;
        hasUpdates = true;
        return { ...connection, sslMode, ssh, connectionString };
      });
      return hasUpdates ? { connections } : state;
    });
  }
  const restored = new Map(next.map((connection) => [connection.id, connection.connectionString]));
  for (const connection of useConnectionsStore.getState().connections)
    if (restored.get(connection.id) === connection.connectionString)
      markQuerySecretResolved(connection);
  if (plaintextParams) useConnectionsStore.setState({});
}

export function isReadOnlyConnection(
  connection: Pick<SavedConnection, "kind" | "readOnly"> | null | undefined,
): boolean {
  if (!connection?.readOnly) return false;
  return capabilitiesFor(connection.kind).read_only_mode;
}
