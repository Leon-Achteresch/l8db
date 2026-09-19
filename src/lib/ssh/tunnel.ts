import { type SavedConnection, useConnectionsStore } from "@/lib/connections";
import { listSshTunnels, openSshTunnel } from "@/lib/db";
import { loadSecret } from "@/lib/secrets";
import { useSettingsStore } from "@/lib/settings";
import { sshSecretAccount } from "./connection-string";
import type { SshAuthRequest, SshTunnelRequest } from "./types";

export interface TunnelOutcome {
  ok: boolean;
  error?: string;
}

async function buildTunnelRequest(
  connection: SavedConnection,
  sshPassword: string | null,
): Promise<SshTunnelRequest | null> {
  const ssh = connection.ssh;
  if (!ssh?.host) return null;
  let secret = sshPassword;
  if (secret == null) {
    try {
      secret = await loadSecret(sshSecretAccount(connection.id));
    } catch {
      secret = null;
    }
  }
  const auth: SshAuthRequest =
    ssh.auth === "key"
      ? { key_file: ssh.keyFile, ...(secret ? { passphrase: secret } : {}) }
      : { password: secret ?? "" };
  if (ssh.auth === "password" && !secret) return null;
  if (ssh.auth === "key" && !ssh.keyFile.trim()) return null;
  return {
    id: connection.id,
    host: ssh.host,
    port: ssh.port,
    user: ssh.user,
    auth,
    remote_host: ssh.remoteHost || "127.0.0.1",
    remote_port: ssh.remotePort,
    accept_new_host_key: useSettingsStore.getState().sshTrustNewHosts,
  };
}

export async function ensureSshTunnel(
  connection: SavedConnection,
  sshPassword?: string | null,
): Promise<TunnelOutcome> {
  if (!connection.ssh?.host) return { ok: true };
  if (connection.tunnelPort) {
    try {
      const tunnels = await listSshTunnels();
      if (tunnels.some((t) => t.id === connection.id)) return { ok: true };
    } catch {
      return { ok: false, error: "SSH-Tunnel konnten nicht geprüft werden." };
    }
  }
  const request = await buildTunnelRequest(connection, sshPassword ?? null);
  if (!request) {
    return {
      ok: false,
      error:
        connection.ssh.auth === "key"
          ? "SSH-Key-Datei fehlt – bitte Verbindung bearbeiten."
          : "SSH-Passwort fehlt – bitte Verbindung bearbeiten und erneut speichern.",
    };
  }
  try {
    const info = await openSshTunnel(request);
    useConnectionsStore.setState((state) => ({
      connections: state.connections.map((entry) =>
        entry.id === connection.id ? { ...entry, tunnelPort: info.local_port } : entry,
      ),
    }));
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}
