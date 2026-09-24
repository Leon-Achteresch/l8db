import { withTimeout } from "@/lib/async";
import { kindFromUrl, parseConnectionUrl } from "@/lib/connection-url";
import type { SavedConnection, SshAuth } from "@/lib/connections";
import type { DatabaseKind, ProviderInfo, SslMode } from "@/lib/db";
import { loadSecret, withSslModeParam } from "@/lib/secrets";
import { useSettingsStore } from "@/lib/settings";
import {
  closeSshTunnel,
  openNetworkTunnel,
  proxySecretAccount,
  sshSecretAccount,
  tunneledConnectionString,
} from "@/lib/ssh";
import { type Mode, TEST_TIMEOUT_MS } from "./types";
import type { NetworkDraft } from "./use-network-draft";

export interface ConnectionUrlActionsContext {
  mode: Mode;
  value: string;
  kind: DatabaseKind;
  providers: ProviderInfo[];
  info: ProviderInfo;
  ssl: SslMode;
  file: string;
  tnsAlias: string;
  user: string;
  password: string;
  host: string;
  port: string;
  database: string;
  extraParams: string;
  windowsAuth: boolean;
  withSsl: (url: string) => string;
  sshEnabled: boolean;
  sshPort: string;
  sshHost: string;
  sshUser: string;
  sshAuth: SshAuth;
  sshKey: string;
  sshPassword: string;
  network: NetworkDraft;
  connection: SavedConnection | undefined;
}

export function createConnectionUrlActions(ctx: ConnectionUrlActionsContext) {
  const {
    mode,
    value,
    kind,
    providers,
    info,
    ssl,
    file,
    tnsAlias,
    user,
    password,
    host,
    port,
    database,
    extraParams,
    windowsAuth,
    withSsl,
    sshEnabled,
    sshPort,
    sshHost,
    sshUser,
    sshAuth,
    sshKey,
    sshPassword,
    network,
    connection,
  } = ctx;

  function makeUrl() {
    if (mode === "string") {
      const inputKind = kindFromUrl(value) ?? kind;
      const inputInfo = providers.find((entry) => entry.kind === inputKind) ?? info;
      if (!value.trim()) {
        throw new Error(
          inputInfo.file_based
            ? "Gib den Pfad zur Datenbankdatei an."
            : "Gib eine Verbindungs-URL ein, z. B. postgresql://…",
        );
      }
      if (inputInfo.file_based) return parseConnectionUrl(value, inputKind).toString();
      const connectionString = parseConnectionUrl(value, inputKind).toString();
      return inputInfo.capabilities.ssl
        ? withSslModeParam(connectionString, ssl)
        : connectionString;
    }
    if (info.file_based) return parseConnectionUrl(file, kind).toString();
    if (mode === "tns") {
      const alias = tnsAlias.trim();
      if (!alias) throw new Error("Wähle einen TNS-Alias aus.");
      if (!user.trim()) throw new Error("Der Benutzer ist erforderlich.");
      const auth = `${encodeURIComponent(user.trim())}${password ? `:${encodeURIComponent(password)}` : ""}@`;
      return parseConnectionUrl(
        `oracle://${auth}${encodeURIComponent(alias)}/?connect_string=${encodeURIComponent(alias)}`,
        kind,
      ).toString();
    }
    if (!host.trim()) throw new Error("Der Host ist erforderlich.");
    if (port) validatePort(port);
    const hostname = host.includes(":") && !host.startsWith("[") ? `[${host.trim()}]` : host.trim();
    const auth =
      user.trim() || password
        ? `${encodeURIComponent(user.trim())}${password ? `:${encodeURIComponent(password)}` : ""}@`
        : "";
    const url = new URL(
      `${info.url_schemes[0]}://${auth}${hostname}${port ? `:${port}` : ""}/${encodeURIComponent(database.trim())}`,
    );
    url.search = extraParams;
    if (windowsAuth) url.searchParams.set("trusted_connection", "true");
    return withSsl(parseConnectionUrl(url.toString(), kind).toString());
  }

  function validatePort(candidate: string) {
    if (!/^\d+$/.test(candidate) || Number(candidate) < 1 || Number(candidate) > 65535)
      throw new Error("Ports müssen zwischen 1 und 65535 liegen.");
  }

  function jumpHostsConfig() {
    return network.jumpHosts.map((jump, index) => {
      const label = `Sprung-Host ${index + 1}`;
      validatePort(jump.port);
      if (!jump.host.trim() || !jump.user.trim())
        throw new Error(`${label}: Host und Benutzer sind erforderlich.`);
      if (jump.auth === "key" && !jump.keyFile.trim())
        throw new Error(`${label}: Wähle eine SSH-Key-Datei.`);
      if (jump.auth === "password" && !jump.secret)
        throw new Error(`${label}: Das SSH-Passwort fehlt.`);
      return {
        host: jump.host.trim(),
        port: Number(jump.port),
        user: jump.user.trim(),
        auth: jump.auth,
        keyFile: jump.auth === "key" ? jump.keyFile.trim() : "",
        ...(jump.auth === "agent" && jump.agentSocket.trim()
          ? { agentSocket: jump.agentSocket.trim() }
          : {}),
      };
    });
  }

  async function configuration() {
    const inputKind = mode === "string" ? (kindFromUrl(value) ?? kind) : kind;
    const inputInfo = providers.find((entry) => entry.kind === inputKind) ?? info;
    const connectionString = makeUrl();
    const target = inputInfo.file_based ? null : parseConnectionUrl(connectionString, inputKind);
    const useSsh = inputInfo.capabilities.ssh && sshEnabled;
    const useProxy = Boolean(target) && inputInfo.capabilities.ssh && network.proxyEnabled;
    if (useSsh) {
      validatePort(sshPort);
      if (!sshHost.trim() || !sshUser.trim())
        throw new Error("SSH-Host und SSH-Benutzer sind erforderlich.");
      if (sshAuth === "key" && !sshKey.trim()) throw new Error("Wähle eine SSH-Key-Datei.");
    }
    if (useProxy) {
      if (!network.proxyHost.trim()) throw new Error("Der Proxy-Host ist erforderlich.");
      validatePort(network.proxyPort);
    }
    const jumpHosts = useSsh ? jumpHostsConfig() : [];
    const secret =
      sshAuth === "agent"
        ? ""
        : sshPassword ||
          (connection && useSsh ? await loadSecret(sshSecretAccount(connection.id)) : null) ||
          "";
    if (useSsh && sshAuth === "password" && !secret) throw new Error("Das SSH-Passwort fehlt.");
    const proxyUser = network.proxyUser.trim();
    const proxySecret = proxyUser
      ? network.proxyPassword ||
        (connection && useProxy ? await loadSecret(proxySecretAccount(connection.id)) : null) ||
        ""
      : "";
    return {
      connectionString,
      secret,
      secrets: {
        ssh: secret || null,
        jumps: network.jumpHosts.map((jump) => (jump.auth === "agent" ? "" : jump.secret)),
        proxy: proxySecret || null,
      },
      kind: inputKind,
      ssh:
        useSsh && target
          ? {
              host: sshHost.trim(),
              port: Number(sshPort),
              user: sshUser.trim(),
              auth: sshAuth,
              keyFile: sshKey.trim(),
              ...(sshAuth === "agent" && network.sshAgentSocket.trim()
                ? { agentSocket: network.sshAgentSocket.trim() }
                : {}),
              ...(jumpHosts.length ? { jumpHosts } : {}),
              remoteHost: target.hostname.replace(/^\[|\]$/g, ""),
              remotePort: Number(target.port || inputInfo.default_port || 0),
            }
          : null,
      proxy: useProxy
        ? {
            type: network.proxyType,
            host: network.proxyHost.trim(),
            port: Number(network.proxyPort),
            ...(proxyUser ? { username: proxyUser } : {}),
          }
        : null,
    };
  }

  async function withLiveUrl<T>(run: (kind: DatabaseKind, url: string) => Promise<T>) {
    const tunnelId = `test-${crypto.randomUUID()}`;
    let tunnelOpened = false;
    try {
      const config = await configuration();
      let url = config.connectionString;
      if (config.ssh || config.proxy) {
        const tunnel = await openNetworkTunnel(
          tunnelId,
          config,
          config.secrets,
          useSettingsStore.getState().sshTrustNewHosts,
        );
        tunnelOpened = true;
        url = tunneledConnectionString(url, tunnel.local_port, config.kind);
      }
      return await withTimeout(
        run(config.kind, url),
        TEST_TIMEOUT_MS,
        `Zeitüberschreitung nach ${TEST_TIMEOUT_MS / 1000} s. Prüfe Host, Port und Firewall.`,
      );
    } finally {
      if (tunnelOpened) await closeSshTunnel(tunnelId).catch(() => undefined);
    }
  }

  return { makeUrl, validatePort, configuration, withLiveUrl };
}
