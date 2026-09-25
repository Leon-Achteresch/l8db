import { type SavedConnection, useConnectionsStore, usesTunnel } from "@/lib/connections";
import { listSshTunnels } from "@/lib/db";
import { useSettingsStore } from "@/lib/settings";
import { loadNetworkSecrets, openNetworkTunnel } from "./network";

export interface TunnelOutcome {
  ok: boolean;
  error?: string;
}

export async function ensureSshTunnel(
  connection: SavedConnection,
  sshPassword?: string | null,
): Promise<TunnelOutcome> {
  if (!usesTunnel(connection)) return { ok: true };
  if (connection.tunnelPort) {
    try {
      const tunnels = await listSshTunnels();
      if (tunnels.some((t) => t.id === connection.id)) return { ok: true };
    } catch {
      return { ok: false, error: "Netzwerk-Tunnel konnten nicht geprüft werden." };
    }
  }
  try {
    const secrets = await loadNetworkSecrets(connection.id);
    const info = await openNetworkTunnel(
      connection.id,
      connection,
      sshPassword == null ? secrets : { ...secrets, ssh: sshPassword },
      useSettingsStore.getState().sshTrustNewHosts,
    );
    useConnectionsStore.setState((state) => ({
      connections: state.connections.map((entry) =>
        entry.id === connection.id ? { ...entry, tunnelPort: info.local_port } : entry,
      ),
    }));
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
