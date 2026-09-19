import { sslModeFromUrl } from "@/lib/connection-url";
import { capabilitiesFor } from "@/lib/providers";
import { extractUrlPassword, injectUrlPassword, loadSecret, storeSecret } from "@/lib/secrets";
import { useConnectionsStore } from "./store";
import type { SavedConnection } from "./types";

let secretsInitialized = false;

export async function initConnectionSecrets(): Promise<void> {
  if (secretsInitialized) return;
  secretsInitialized = true;
  const { connections } = useConnectionsStore.getState();
  if (connections.length === 0) return;
  let changed = false;
  const next = await Promise.all(
    connections.map((connection) =>
      (async () => {
        const withDefaults: SavedConnection = {
          ssh: null,
          ...connection,
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
    useConnectionsStore.setState({ connections: next });
  }
}

export function isReadOnlyConnection(
  connection: Pick<SavedConnection, "kind" | "readOnly"> | null | undefined,
): boolean {
  if (!connection?.readOnly) return false;
  return capabilitiesFor(connection.kind).read_only_mode;
}
