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

function stripSecretParams(query: string): string {
  const kept = query
    .split("&")
    .filter((pair) => pair.length > 0)
    .filter((pair) => {
      const key = pair.split("=")[0] ?? "";
      let decoded = key;
      try {
        decoded = decodeURIComponent(key);
      } catch {
        decoded = key;
      }
      return !SECRET_PARAM.test(decoded);
    });
  return kept.join("&");
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
  const query = stripSecretParams(beforeHash.slice(queryIndex + 1));
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
        remoteHost: connection.ssh.remoteHost,
        remotePort: connection.ssh.remotePort,
      }
    : null;
  return {
    id: connection.id,
    name: connection.name,
    kind: connection.kind,
    connectionString: stripConnectionSecrets(connection.connectionString),
    sslMode: connection.sslMode,
    ssh,
    tags: (connection.tags ?? []).map((tag) => ({ name: tag.name, color: tag.color })),
    favorite: Boolean(connection.favorite),
    color: connection.color ?? null,
    schemas: connection.schemas?.length ? [...connection.schemas] : null,
    showSingleSchemaSwitcher: connection.showSingleSchemaSwitcher ?? true,
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
