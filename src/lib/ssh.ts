import { AUTH_ERROR_PATTERN, connectionError } from "@/lib/connection-url";
import {
  closeSshTunnel,
  type DatabaseKind,
  listSshTunnels,
  openSshTunnel,
  registerReadOnlyResolver,
  testConnectionString,
} from "@/lib/db";

export { closeSshTunnel, listSshTunnels, openSshTunnel } from "@/lib/db";

import { toast } from "sonner";
import { create } from "zustand";

import { isReadOnlyConnection, type SavedConnection, useConnectionsStore } from "@/lib/connections";
import { ensurePassword } from "@/lib/password-prompt";
import { loadSecret } from "@/lib/secrets";
import { useSettingsStore } from "@/lib/settings";
import { getTransactionForConnection } from "@/lib/transactions";

export type SshAuthRequest = { password: string } | { key_file: string; passphrase?: string };

export interface SshTunnelRequest {
  id: string;
  host: string;
  port: number;
  user: string;
  auth: SshAuthRequest;
  remote_host: string;
  remote_port: number;
  accept_new_host_key: boolean;
}

export interface SshTunnelInfo {
  id: string;
  local_port: number;
  ssh_host: string;
  ssh_port: number;
  ssh_user: string;
  remote_host: string;
  remote_port: number;
}

export function sshSecretAccount(connectionId: string): string {
  return `${connectionId}:ssh`;
}

export function rewriteHostPort(url: string, host: string, port: number): string {
  const scheme = url.indexOf("://");
  if (scheme < 0) return url;
  const prefix = url.slice(0, scheme + 3);
  const rest = url.slice(scheme + 3);
  const authEnd = rest.search(/[/?#]/);
  const end = authEnd < 0 ? rest.length : authEnd;
  const authority = rest.slice(0, end);
  const tail = rest.slice(end);
  const at = authority.lastIndexOf("@");
  const userinfo = at < 0 ? "" : `${authority.slice(0, at)}@`;
  return `${prefix}${userinfo}${host}:${port}${tail}`;
}

export function tunneledConnectionString(
  value: string,
  port: number,
  kind: DatabaseKind = "postgres",
): string {
  if (kind !== "postgres") return rewriteHostPort(value, "127.0.0.1", port);
  const url = new URL(value);
  url.port = String(port);
  const params = url.search
    .slice(1)
    .split("&")
    .filter(
      (part) => part && !["hostaddr", "port"].includes(decodeURIComponent(part.split("=")[0])),
    );
  params.push("hostaddr=127.0.0.1");
  url.search = params.join("&");
  return url.toString();
}

export const READ_ONLY_OPTION = "-c default_transaction_read_only=on";

export function readOnlyConnectionString(value: string): string {
  const url = new URL(value);
  const params = url.search
    .slice(1)
    .split("&")
    .filter((part) => part && decodeURIComponent(part.split("=")[0]) !== "options");
  params.push(`options=${encodeURIComponent(READ_ONLY_OPTION)}`);
  url.search = params.join("&");
  return url.toString();
}

registerReadOnlyResolver((connectionString) => {
  const { connections, activeId } = useConnectionsStore.getState();
  if (typeof connectionString === "string") {
    const matches = connections.filter((entry) => {
      try {
        return effectiveConnectionString(entry) === connectionString;
      } catch {
        return false;
      }
    });
    if (matches.length) return matches.some(isReadOnlyConnection);
  }
  return isReadOnlyConnection(connections.find((entry) => entry.id === activeId));
});

export function effectiveConnectionString(connection: SavedConnection): string {
  const base = isReadOnlyConnection(connection)
    ? readOnlyConnectionString(connection.connectionString)
    : connection.connectionString;
  if (!connection.ssh?.host) return base;
  if (!connection.tunnelPort)
    throw new Error("SSH-Tunnel ist nicht verbunden. Bitte erneut verbinden.");
  return tunneledConnectionString(base, connection.tunnelPort, connection.kind);
}

interface TunnelOutcome {
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

interface ConnectionSwitchState {
  targetId: string | null;
  isSwitching: boolean;
  errorId: string | null;
}

export const useConnectionSwitch = create<ConnectionSwitchState>(() => ({
  targetId: null,
  isSwitching: false,
  errorId: null,
}));

async function performActivation(
  id: string | null,
  sshPassword?: string | null,
): Promise<TunnelOutcome> {
  useConnectionSwitch.setState({ targetId: id, isSwitching: true, errorId: null });
  try {
    const store = useConnectionsStore.getState();
    const previous = store.connections.find((entry) => entry.id === store.activeId);
    const next = id ? store.connections.find((entry) => entry.id === id) : undefined;
    if (previous && previous.id !== id && getTransactionForConnection(previous.id)) {
      return {
        ok: false,
        error:
          "Schließe zuerst die offene Transaktion ab: Übernehmen oder Zurückrollen im Transaktionspanel.",
      };
    }
    if (id && !next) return { ok: false, error: "Verbindung nicht gefunden." };
    if (next?.ssh?.host) {
      const outcome = await ensureSshTunnel(next, sshPassword);
      if (!outcome.ok) return outcome;
    }
    if (next) {
      try {
        const current = useConnectionsStore.getState().connections.find((entry) => entry.id === id);
        if (!current) return { ok: false, error: "Verbindung wurde entfernt." };
        await testConnectionString(current.kind, effectiveConnectionString(current));
        if (
          useConnectionsStore.getState().connections.find((entry) => entry.id === id) !== current
        ) {
          return {
            ok: false,
            error: "Die Verbindung wurde während des Tests geändert. Bitte erneut verbinden.",
          };
        }
      } catch (error) {
        if (next.ssh?.host && previous?.id !== next.id) {
          await closeSshTunnel(next.id).catch(() => undefined);
          useConnectionsStore.setState((state) => ({
            connections: state.connections.map((entry) =>
              entry.id === next.id ? { ...entry, tunnelPort: null } : entry,
            ),
          }));
        }
        return { ok: false, error: connectionError(error) };
      }
    }
    if (previous?.tunnelPort && previous.id !== id) {
      try {
        await closeSshTunnel(previous.id);
      } catch {
        toast.warning("Der bisherige SSH-Tunnel konnte nicht geschlossen werden.");
      }
      useConnectionsStore.setState((state) => ({
        connections: state.connections.map((entry) =>
          entry.id === previous.id ? { ...entry, tunnelPort: null } : entry,
        ),
      }));
    }
    store.setActiveId(id);
    return { ok: true };
  } finally {
    useConnectionSwitch.setState({ targetId: null, isSwitching: false });
  }
}

const ACTIVATION_TIMEOUT_MS = 30_000;
let activationQueue: Promise<unknown> = Promise.resolve();

export function activateConnection(
  id: string | null,
  sshPassword?: string | null,
): Promise<TunnelOutcome> {
  const result = activationQueue.then(async () => {
    const outcome = await Promise.race([
      performActivation(id, sshPassword),
      new Promise<TunnelOutcome>((resolve) =>
        setTimeout(() => {
          useConnectionSwitch.setState({ targetId: null, isSwitching: false });
          resolve({ ok: false, error: "Zeitüberschreitung beim Verbindungswechsel." });
        }, ACTIVATION_TIMEOUT_MS),
      ),
    ]);
    if (!outcome.ok) {
      useConnectionSwitch.setState({ errorId: id ?? useConnectionsStore.getState().activeId });
    }
    return outcome;
  });
  activationQueue = result.catch(() => undefined);
  return result;
}

export async function activateConnectionWithToast(
  id: string | null,
  sshPassword?: string | null,
): Promise<boolean> {
  const target = id
    ? useConnectionsStore.getState().connections.find((entry) => entry.id === id)
    : null;
  const label = target?.name ?? "Verbindung";
  if (id && !(await ensurePassword(id))) return false;
  const pending = id
    ? toast.loading(`Verbinde mit „${label}“…`)
    : toast.loading("Trenne Verbindung…");
  try {
    let outcome = await activateConnection(id, sshPassword);
    while (id && !outcome.ok && AUTH_ERROR_PATTERN.test(outcome.error ?? "")) {
      toast.dismiss(pending);
      if (
        !(await ensurePassword(
          id,
          `Anmeldung bei „${label}“ fehlgeschlagen. Passwort erneut eingeben.`,
        ))
      )
        return false;
      outcome = await activateConnection(id, sshPassword);
    }
    if (!outcome.ok) {
      toast.error(outcome.error ?? "Verbindung konnte nicht aktiviert werden.");
    } else if (id) {
      toast.success(`Mit „${label}“ verbunden`);
    } else {
      toast.success("Verbindung getrennt");
    }
    return outcome.ok;
  } catch (error) {
    toast.error(String(error));
    return false;
  } finally {
    toast.dismiss(pending);
  }
}

export async function restoreSshTunnel(): Promise<void> {
  const store = useConnectionsStore.getState();
  const active = store.connections.find((entry) => entry.id === store.activeId);
  if (!active?.ssh?.host) return;
  const outcome = await ensureSshTunnel(active);
  if (!outcome.ok) {
    toast.error(`SSH-Tunnel fehlgeschlagen: ${outcome.error ?? "Unbekannter Fehler"}`);
    await activateConnection(null);
  }
}
