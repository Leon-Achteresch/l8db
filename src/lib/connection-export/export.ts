import type { SavedConnection } from "@/lib/connections";
import { scrubUrlPassword } from "@/lib/secrets";
import {
  CONNECTION_EXPORT_FORMAT,
  CONNECTION_EXPORT_VERSION,
  type ConnectionExportFile,
  type ExportedConnection,
  type ExportedSsh,
  SECRET_PARAM,
} from "./types";

function isSecretParam(pair: string): boolean {
  const key = pair.split("=")[0] ?? "";
  let decoded = key;
  try {
    decoded = decodeURIComponent(key);
  } catch {
    decoded = key;
  }
  return SECRET_PARAM.test(decoded);
}

export function splitSecretParams(value: string): { value: string; secrets: string | null } {
  if (!value.includes("://")) return { value, secrets: null };
  const hashIndex = value.indexOf("#");
  const beforeHash = hashIndex < 0 ? value : value.slice(0, hashIndex);
  const hash = hashIndex < 0 ? "" : value.slice(hashIndex);
  const queryIndex = beforeHash.indexOf("?");
  if (queryIndex < 0) return { value, secrets: null };
  const pairs = beforeHash
    .slice(queryIndex + 1)
    .split("&")
    .filter((pair) => pair.length > 0);
  const secrets = pairs.filter(isSecretParam);
  if (secrets.length === 0) return { value, secrets: null };
  const kept = pairs.filter((pair) => !isSecretParam(pair)).join("&");
  const base = beforeHash.slice(0, queryIndex);
  return { value: kept ? `${base}?${kept}${hash}` : base + hash, secrets: secrets.join("&") };
}

export function withSecretParams(value: string, secrets: string | null): string {
  if (!secrets || !value.includes("://") || splitSecretParams(value).secrets !== null) return value;
  const hashIndex = value.indexOf("#");
  const beforeHash = hashIndex < 0 ? value : value.slice(0, hashIndex);
  const hash = hashIndex < 0 ? "" : value.slice(hashIndex);
  const separator = !beforeHash.includes("?") ? "?" : beforeHash.endsWith("?") ? "" : "&";
  return `${beforeHash}${separator}${secrets}${hash}`;
}

export function stripConnectionSecrets(value: string): string {
  if (!value.includes("://")) {
    return value
      .split(";")
      .filter((entry) => {
        const key = entry.split("=")[0]?.trim() ?? "";
        return key.length === 0 || !SECRET_PARAM.test(key);
      })
      .join(";");
  }
  const scrubbed = scrubUrlPassword(value).replace(/^([a-z][a-z0-9+.-]*:\/\/)@/i, "$1");
  const hashIndex = scrubbed.indexOf("#");
  const beforeHash = hashIndex < 0 ? scrubbed : scrubbed.slice(0, hashIndex);
  const hash = hashIndex < 0 ? "" : scrubbed.slice(hashIndex);
  const queryIndex = beforeHash.indexOf("?");
  if (queryIndex < 0) return beforeHash + hash;
  const base = beforeHash.slice(0, queryIndex);
  const query = beforeHash
    .slice(queryIndex + 1)
    .split("&")
    .filter((pair) => pair.length > 0 && !isSecretParam(pair))
    .join("&");
  return query ? `${base}?${query}${hash}` : base + hash;
}

export function toExportedConnection(connection: SavedConnection): ExportedConnection {
  const ssh: ExportedSsh | null = connection.ssh?.host
    ? {
        host: connection.ssh.host,
        port: connection.ssh.port,
        user: connection.ssh.user,
        auth: connection.ssh.auth,
        keyFile: connection.ssh.auth === "key" ? connection.ssh.keyFile : "",
        ...(connection.ssh.auth === "agent" && connection.ssh.agentSocket
          ? { agentSocket: connection.ssh.agentSocket }
          : {}),
        ...(connection.ssh.jumpHosts?.length
          ? {
              jumpHosts: connection.ssh.jumpHosts.map((jump) => ({
                host: jump.host,
                port: jump.port,
                user: jump.user,
                auth: jump.auth,
                keyFile: jump.auth === "key" ? jump.keyFile : "",
                ...(jump.auth === "agent" && jump.agentSocket
                  ? { agentSocket: jump.agentSocket }
                  : {}),
              })),
            }
          : {}),
        remoteHost: connection.ssh.remoteHost,
        remotePort: connection.ssh.remotePort,
      }
    : null;
  const proxy = connection.proxy?.host
    ? {
        type: connection.proxy.type,
        host: connection.proxy.host,
        port: connection.proxy.port,
        ...(connection.proxy.username ? { username: connection.proxy.username } : {}),
      }
    : null;
  return {
    id: connection.id,
    name: connection.name,
    kind: connection.kind,
    connectionString: stripConnectionSecrets(connection.connectionString),
    sslMode: connection.sslMode,
    ssh,
    ...(proxy ? { proxy } : {}),
    tags: (connection.tags ?? []).map((tag) => ({ name: tag.name, color: tag.color })),
    favorite: Boolean(connection.favorite),
    color: connection.color ?? null,
    schemas: connection.schemas?.length ? [...connection.schemas] : null,
    showSingleSchemaSwitcher: connection.showSingleSchemaSwitcher ?? true,
    environment: connection.environment ?? null,
    readOnly: Boolean(connection.readOnly),
    maskRules: (connection.maskRules ?? []).map((rule) => ({
      name: rule.name,
      pattern: rule.pattern,
      enabled: rule.enabled,
      mask: rule.mask ?? null,
    })),
  };
}

export function buildConnectionExport(
  connections: SavedConnection[],
  now: Date = new Date(),
): ConnectionExportFile {
  return {
    format: CONNECTION_EXPORT_FORMAT,
    version: CONNECTION_EXPORT_VERSION,
    exportedAt: now.toISOString(),
    connections: connections.map(toExportedConnection),
  };
}

export function serializeConnectionExport(connections: SavedConnection[]): string {
  return JSON.stringify(buildConnectionExport(connections), null, 2);
}
