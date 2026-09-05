import { invoke } from "@tauri-apps/api/core"
import { toast } from "sonner"

import {
  useConnectionsStore,
  type SavedConnection,
} from "@/lib/connections"
import { loadSecret } from "@/lib/secrets"
import { useSettingsStore } from "@/lib/settings"

export type SshAuthRequest =
  | { password: string }
  | { key_file: string; passphrase?: string }

export interface SshTunnelRequest {
  id: string
  host: string
  port: number
  user: string
  auth: SshAuthRequest
  remote_host: string
  remote_port: number
  accept_new_host_key: boolean
}

export interface SshTunnelInfo {
  id: string
  local_port: number
  ssh_host: string
  ssh_port: number
  ssh_user: string
  remote_host: string
  remote_port: number
}

export async function openSshTunnel(request: SshTunnelRequest): Promise<SshTunnelInfo> {
  return invoke("open_ssh_tunnel", { request })
}

export async function closeSshTunnel(id: string): Promise<void> {
  await invoke("close_ssh_tunnel", { id })
}

export async function listSshTunnels(): Promise<SshTunnelInfo[]> {
  return invoke("list_ssh_tunnels")
}

export function sshSecretAccount(connectionId: string): string {
  return `${connectionId}:ssh`
}

export function rewriteHostPort(url: string, host: string, port: number): string {
  const scheme = url.indexOf("://")
  if (scheme < 0) return url
  const prefix = url.slice(0, scheme + 3)
  const rest = url.slice(scheme + 3)
  const authEnd = rest.search(/[\/?#]/)
  const end = authEnd < 0 ? rest.length : authEnd
  const authority = rest.slice(0, end)
  const tail = rest.slice(end)
  const at = authority.lastIndexOf("@")
  const userinfo = at < 0 ? "" : `${authority.slice(0, at)}@`
  return `${prefix}${userinfo}${host}:${port}${tail}`
}

export function effectiveConnectionString(connection: SavedConnection): string {
  if (!connection.tunnelPort) return connection.connectionString
  return rewriteHostPort(connection.connectionString, "127.0.0.1", connection.tunnelPort)
}

interface TunnelOutcome {
  ok: boolean
  error?: string
}

async function buildTunnelRequest(
  connection: SavedConnection,
  sshPassword: string | null,
): Promise<SshTunnelRequest | null> {
  const ssh = connection.ssh
  if (!ssh?.host) return null
  let secret = sshPassword
  if (secret == null) {
    try {
      secret = await loadSecret(sshSecretAccount(connection.id))
    } catch {
      secret = null
    }
  }
  const auth: SshAuthRequest =
    ssh.auth === "key"
      ? { key_file: ssh.keyFile, ...(secret ? { passphrase: secret } : {}) }
      : { password: secret ?? "" }
  if (ssh.auth === "password" && !secret) return null
  if (ssh.auth === "key" && !ssh.keyFile.trim()) return null
  return {
    id: connection.id,
    host: ssh.host,
    port: ssh.port,
    user: ssh.user,
    auth,
    remote_host: ssh.remoteHost || "127.0.0.1",
    remote_port: ssh.remotePort,
    accept_new_host_key: useSettingsStore.getState().sshTrustNewHosts,
  }
}

export async function ensureSshTunnel(
  connection: SavedConnection,
  sshPassword?: string | null,
): Promise<TunnelOutcome> {
  if (!connection.ssh?.host) return { ok: true }
  if (connection.tunnelPort) {
    try {
      const tunnels = await listSshTunnels()
      if (tunnels.some((t) => t.id === connection.id)) return { ok: true }
    } catch {
      return { ok: false, error: "SSH-Tunnel konnten nicht geprüft werden." }
    }
  }
  const request = await buildTunnelRequest(connection, sshPassword ?? null)
  if (!request) {
    return {
      ok: false,
      error:
        connection.ssh.auth === "key"
          ? "SSH-Key-Datei fehlt – bitte Verbindung bearbeiten."
          : "SSH-Passwort fehlt – bitte Verbindung bearbeiten und erneut speichern.",
    }
  }
  try {
    const info = await openSshTunnel(request)
    useConnectionsStore.setState((state) => ({
      connections: state.connections.map((entry) =>
        entry.id === connection.id ? { ...entry, tunnelPort: info.local_port } : entry,
      ),
    }))
    return { ok: true }
  } catch (error) {
    return { ok: false, error: String(error) }
  }
}

export async function activateConnection(
  id: string | null,
  sshPassword?: string | null,
): Promise<TunnelOutcome> {
  const store = useConnectionsStore.getState()
  if (id === store.activeId) return { ok: true }
  const previous = store.connections.find((entry) => entry.id === store.activeId)
  const next = id ? store.connections.find((entry) => entry.id === id) : undefined
  if (id && !next) return { ok: false, error: "Verbindung nicht gefunden." }
  if (next?.ssh?.host) {
    const outcome = await ensureSshTunnel(next, sshPassword)
    if (!outcome.ok) return outcome
  }
  if (previous?.tunnelPort && previous.id !== id) {
    try {
      await closeSshTunnel(previous.id)
    } catch {
      /* best effort */
    }
    useConnectionsStore.setState((state) => ({
      connections: state.connections.map((entry) =>
        entry.id === previous.id ? { ...entry, tunnelPort: null } : entry,
      ),
    }))
  }
  store.setActiveId(id)
  return { ok: true }
}

export async function activateConnectionWithToast(
  id: string | null,
  sshPassword?: string | null,
): Promise<boolean> {
  const outcome = await activateConnection(id, sshPassword)
  if (!outcome.ok) {
    toast.error(outcome.error ?? "Verbindung konnte nicht aktiviert werden.")
  }
  return outcome.ok
}

export async function restoreSshTunnel(): Promise<void> {
  const store = useConnectionsStore.getState()
  const active = store.connections.find((entry) => entry.id === store.activeId)
  if (!active?.ssh?.host) return
  const outcome = await ensureSshTunnel(active)
  if (!outcome.ok) {
    toast.error(`SSH-Tunnel fehlgeschlagen: ${outcome.error ?? "Unbekannter Fehler"}`)
    await activateConnection(null)
  }
}
