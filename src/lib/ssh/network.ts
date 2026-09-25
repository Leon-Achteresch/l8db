import { parseConnectionUrl } from "@/lib/connection-url";
import type { NetworkProxy, SshAuth, SshConnection, SshJumpHost } from "@/lib/connections";
import { type DatabaseKind, openProxyTunnel, openSshTunnel } from "@/lib/db";
import { providerForKind } from "@/lib/providers";
import { loadSecret } from "@/lib/secrets";
import type {
  ProxyRequest,
  ProxyTunnelRequest,
  SshAuthRequest,
  SshConfigHost,
  SshTunnelInfo,
  SshTunnelRequest,
} from "./types";

export const ONEPASSWORD_AGENT_SOCKET_MAC =
  "~/Library/Group Containers/2BUA8C4S2C.com.1password/t/agent.sock";
export const ONEPASSWORD_AGENT_SOCKET_LINUX = "~/.1password/agent.sock";

export function onePasswordAgentSocket(
  platform = typeof navigator === "undefined" ? "" : navigator.platform,
): string | null {
  if (/Mac/i.test(platform)) return ONEPASSWORD_AGENT_SOCKET_MAC;
  if (/Linux/i.test(platform)) return ONEPASSWORD_AGENT_SOCKET_LINUX;
  return null;
}

export function sshJumpSecretAccount(connectionId: string): string {
  return `${connectionId}:ssh-jumps`;
}

export function proxySecretAccount(connectionId: string): string {
  return `${connectionId}:proxy`;
}

export function parseJumpSecrets(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.map((entry) => (typeof entry === "string" ? entry : ""))
      : [];
  } catch {
    return [];
  }
}

export function serializeJumpSecrets(secrets: string[]): string | null {
  return secrets.some(Boolean) ? JSON.stringify(secrets) : null;
}

export interface NetworkSecrets {
  ssh: string | null;
  jumps: string[];
  proxy: string | null;
}

export interface NetworkTarget {
  ssh?: SshConnection | null;
  proxy?: NetworkProxy | null;
  kind: DatabaseKind;
  connectionString: string;
}

export function sshAuthRequest(
  auth: SshAuth,
  keyFile: string,
  agentSocket: string | undefined,
  secret: string | null,
  label: string,
): SshAuthRequest {
  if (auth === "agent") {
    const socket = agentSocket?.trim();
    return socket ? { method: "agent", agent_socket: socket } : { method: "agent" };
  }
  if (auth === "key") {
    if (!keyFile.trim())
      throw new Error(`${label}: SSH-Key-Datei fehlt – bitte Verbindung bearbeiten.`);
    return secret
      ? { method: "key", key_file: keyFile.trim(), passphrase: secret }
      : { method: "key", key_file: keyFile.trim() };
  }
  if (!secret)
    throw new Error(
      `${label}: SSH-Passwort fehlt – bitte Verbindung bearbeiten und erneut speichern.`,
    );
  return { method: "password", password: secret };
}

export function proxyRequest(proxy: NetworkProxy, secret: string | null): ProxyRequest {
  const username = proxy.username?.trim();
  return {
    kind: proxy.type,
    host: proxy.host.trim(),
    port: proxy.port,
    ...(username ? { username, password: secret ?? "" } : {}),
  };
}

export function buildSshTunnelRequest(
  id: string,
  ssh: SshConnection,
  proxy: NetworkProxy | null | undefined,
  secrets: NetworkSecrets,
  acceptNewHostKey: boolean,
): SshTunnelRequest {
  return {
    id,
    host: ssh.host,
    port: ssh.port,
    user: ssh.user,
    auth: sshAuthRequest(ssh.auth, ssh.keyFile, ssh.agentSocket, secrets.ssh, "SSH"),
    jump_hosts: (ssh.jumpHosts ?? []).map((jump: SshJumpHost, index) => ({
      host: jump.host,
      port: jump.port,
      user: jump.user,
      auth: sshAuthRequest(
        jump.auth,
        jump.keyFile,
        jump.agentSocket,
        secrets.jumps[index] || null,
        `Sprung-Host ${index + 1}`,
      ),
    })),
    proxy: proxy?.host ? proxyRequest(proxy, secrets.proxy) : null,
    remote_host: ssh.remoteHost || "127.0.0.1",
    remote_port: ssh.remotePort,
    accept_new_host_key: acceptNewHostKey,
  };
}

export function proxyTarget(
  connectionString: string,
  kind: DatabaseKind,
): { host: string; port: number } {
  const url = parseConnectionUrl(connectionString, kind);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const port = Number(url.port || providerForKind(kind)?.default_port || 0);
  if (!host || !port)
    throw new Error(
      "Zielhost und -port der Datenbank konnten für den Proxy nicht ermittelt werden.",
    );
  return { host, port };
}

export function buildProxyTunnelRequest(
  id: string,
  proxy: NetworkProxy,
  secret: string | null,
  target: { host: string; port: number },
): ProxyTunnelRequest {
  return {
    id,
    proxy: proxyRequest(proxy, secret),
    remote_host: target.host,
    remote_port: target.port,
  };
}

async function safeLoad(account: string): Promise<string | null> {
  try {
    return await loadSecret(account);
  } catch {
    return null;
  }
}

export async function loadNetworkSecrets(connectionId: string): Promise<NetworkSecrets> {
  const [ssh, jumps, proxy] = await Promise.all([
    safeLoad(`${connectionId}:ssh`),
    safeLoad(sshJumpSecretAccount(connectionId)),
    safeLoad(proxySecretAccount(connectionId)),
  ]);
  return { ssh, jumps: parseJumpSecrets(jumps), proxy };
}

export async function openNetworkTunnel(
  id: string,
  target: NetworkTarget,
  secrets: NetworkSecrets,
  acceptNewHostKey: boolean,
): Promise<SshTunnelInfo> {
  if (target.ssh?.host)
    return openSshTunnel(
      buildSshTunnelRequest(id, target.ssh, target.proxy, secrets, acceptNewHostKey),
    );
  if (target.proxy?.host)
    return openProxyTunnel(
      buildProxyTunnelRequest(
        id,
        target.proxy,
        secrets.proxy,
        proxyTarget(target.connectionString, target.kind),
      ),
    );
  throw new Error("Für diese Verbindung ist weder SSH noch ein Proxy konfiguriert.");
}

export interface SshConfigDraft {
  host: string;
  port: number;
  user: string;
  auth: SshAuth;
  keyFile: string;
  agentSocket: string;
  jumpHosts: SshJumpHost[];
}

function configAuth(identityAgent: string | null, identityFile: string | null) {
  if (identityAgent) return { auth: "agent" as const, keyFile: "", agentSocket: identityAgent };
  if (identityFile) return { auth: "key" as const, keyFile: identityFile, agentSocket: "" };
  return { auth: "agent" as const, keyFile: "", agentSocket: "" };
}

export function sshConfigDraft(entry: SshConfigHost, fallbackUser = ""): SshConfigDraft {
  return {
    host: entry.host_name || entry.alias,
    port: entry.port ?? 22,
    user: entry.user ?? fallbackUser,
    ...configAuth(entry.identity_agent, entry.identity_file),
    jumpHosts: entry.proxy_jump.map((jump) => ({
      host: jump.host,
      port: jump.port ?? 22,
      user: jump.user ?? entry.user ?? fallbackUser,
      ...configAuth(jump.identity_agent, jump.identity_file),
    })),
  };
}
