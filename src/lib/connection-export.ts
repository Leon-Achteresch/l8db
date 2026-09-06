import {
  type ConnectionTag,
  type SavedConnection,
  type SshConnection,
  createConnectionId,
} from "@/lib/connections";
import type { DatabaseKind, SslMode } from "@/lib/db";
import { scrubUrlPassword } from "@/lib/secrets";

export const CONNECTION_EXPORT_FORMAT = "l8db-connections";
export const CONNECTION_EXPORT_VERSION = 1;

const KINDS: DatabaseKind[] = [
  "postgres",
  "mysql",
  "sqlite",
  "mssql",
  "clickhouse",
  "mongodb",
  "redis",
  "oracle",
  "cassandra",
  "duckdb",
  "odbc",
];

const SSL_MODES: SslMode[] = ["disable", "prefer", "require", "verify-ca", "verify-full"];

const SECRET_PARAM =
  /^(password|passwd|pwd|pass|token|secret|api[_-]?key|access[_-]?key|secret[_-]?key|auth[_-]?token|credential[s]?|sslpassword|ssl[_-]?key[_-]?password|passphrase)$/i;

export interface ExportedSsh {
  host: string;
  port: number;
  user: string;
  auth: "password" | "key";
  keyFile: string;
  remoteHost: string;
  remotePort: number;
}

export interface ExportedConnection {
  id: string;
  name: string;
  kind: DatabaseKind;
  connectionString: string;
  sslMode: SslMode;
  ssh: ExportedSsh | null;
  tags: ConnectionTag[];
  favorite: boolean;
  color: string | null;
}

export interface ConnectionExportFile {
  format: typeof CONNECTION_EXPORT_FORMAT;
  version: number;
  exportedAt: string;
  connections: ExportedConnection[];
}

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

export type DuplicateStrategy = "skip" | "copy";

export interface ImportCandidate {
  index: number;
  profile: ExportedConnection | null;
  label: string;
  error: string | null;
  duplicateOf: SavedConnection | null;
}

export interface ParsedConnectionImport {
  candidates: ImportCandidate[];
  error: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSsh(value: unknown): ExportedSsh | null | string {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) return "SSH-Konfiguration ist kein Objekt.";
  const host = typeof value.host === "string" ? value.host : "";
  if (!host) return null;
  const port = Number(value.port ?? 22);
  const remotePort = Number(value.remotePort ?? 0);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return "SSH-Port ist ungültig.";
  if (!Number.isInteger(remotePort) || remotePort <= 0 || remotePort > 65535)
    return "SSH-Zielport ist ungültig.";
  const auth = value.auth === "password" ? "password" : "key";
  return {
    host,
    port,
    user: typeof value.user === "string" ? value.user : "",
    auth,
    keyFile: typeof value.keyFile === "string" ? value.keyFile : "",
    remoteHost: typeof value.remoteHost === "string" ? value.remoteHost : "",
    remotePort,
  };
}

function parseProfile(value: unknown): ExportedConnection | string {
  if (!isRecord(value)) return "Eintrag ist kein Objekt.";
  const name = typeof value.name === "string" ? value.name.trim() : "";
  if (!name) return "Name fehlt.";
  const kind = value.kind;
  if (typeof kind !== "string" || !KINDS.includes(kind as DatabaseKind))
    return `Unbekannter Datenbanktyp „${String(kind)}“.`;
  const connectionString =
    typeof value.connectionString === "string" ? value.connectionString.trim() : "";
  if (!connectionString) return "Verbindungsparameter fehlen.";
  const sslMode =
    typeof value.sslMode === "string" && SSL_MODES.includes(value.sslMode as SslMode)
      ? (value.sslMode as SslMode)
      : "prefer";
  const ssh = parseSsh(value.ssh);
  if (typeof ssh === "string") return ssh;
  const tags = Array.isArray(value.tags)
    ? value.tags
        .filter(isRecord)
        .filter((tag) => typeof tag.name === "string" && tag.name.trim().length > 0)
        .map((tag) => ({
          name: String(tag.name).trim(),
          color: typeof tag.color === "string" ? tag.color : "#64748b",
        }))
    : [];
  return {
    id: typeof value.id === "string" && value.id ? value.id : createConnectionId(),
    name,
    kind: kind as DatabaseKind,
    connectionString: stripConnectionSecrets(connectionString),
    sslMode,
    ssh,
    tags,
    favorite: value.favorite === true,
    color: typeof value.color === "string" && value.color ? value.color : null,
  };
}

export function findDuplicate(
  profile: ExportedConnection,
  existing: SavedConnection[],
): SavedConnection | null {
  return (
    existing.find((connection) => connection.id === profile.id) ??
    existing.find(
      (connection) =>
        connection.name === profile.name &&
        connection.kind === profile.kind &&
        stripConnectionSecrets(connection.connectionString) === profile.connectionString,
    ) ??
    null
  );
}

export function parseConnectionImport(
  text: string,
  existing: SavedConnection[],
): ParsedConnectionImport {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { candidates: [], error: "Die Datei enthält kein gültiges JSON." };
  }
  if (!isRecord(raw)) return { candidates: [], error: "Die Datei hat kein bekanntes Format." };
  if (raw.format !== CONNECTION_EXPORT_FORMAT)
    return {
      candidates: [],
      error: "Die Datei ist kein l8db-Verbindungsexport.",
    };
  if (typeof raw.version !== "number" || raw.version > CONNECTION_EXPORT_VERSION)
    return {
      candidates: [],
      error: `Exportversion ${String(raw.version)} wird nicht unterstützt (maximal ${CONNECTION_EXPORT_VERSION}).`,
    };
  if (!Array.isArray(raw.connections))
    return { candidates: [], error: "Die Datei enthält keine Verbindungsliste." };
  const candidates: ImportCandidate[] = raw.connections.map((entry, index) => {
    const parsed = parseProfile(entry);
    if (typeof parsed === "string") {
      const label =
        isRecord(entry) && typeof entry.name === "string" && entry.name
          ? entry.name
          : `Eintrag ${index + 1}`;
      return { index, profile: null, label, error: parsed, duplicateOf: null };
    }
    return {
      index,
      profile: parsed,
      label: parsed.name,
      error: null,
      duplicateOf: findDuplicate(parsed, existing),
    };
  });
  return { candidates, error: null };
}

function toSavedConnection(profile: ExportedConnection): SavedConnection {
  const ssh: SshConnection | null = profile.ssh ? { ...profile.ssh } : null;
  return {
    id: profile.id,
    name: profile.name,
    kind: profile.kind,
    connectionString: profile.connectionString,
    sslMode: profile.sslMode,
    ssh,
    tunnelPort: null,
    tags: profile.tags,
    favorite: profile.favorite,
    color: profile.color,
  };
}

export function resolveImport(
  candidates: ImportCandidate[],
  selected: Set<number>,
  strategy: DuplicateStrategy,
): SavedConnection[] {
  const result: SavedConnection[] = [];
  for (const candidate of candidates) {
    if (!candidate.profile || candidate.error || !selected.has(candidate.index)) continue;
    if (candidate.duplicateOf) {
      if (strategy === "skip") continue;
      result.push({
        ...toSavedConnection(candidate.profile),
        id: createConnectionId(),
        name: `${candidate.profile.name} (Kopie)`,
      });
      continue;
    }
    result.push(toSavedConnection(candidate.profile));
  }
  return result;
}
