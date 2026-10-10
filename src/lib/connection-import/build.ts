import type { ExportedConnection, ExportedSsh } from "@/lib/connection-export";
import {
  type ConnectionTag,
  createConnectionId,
  type SavedConnection,
  TAG_COLORS,
} from "@/lib/connections";
import type { DatabaseKind, SslMode } from "@/lib/db";
import { injectUrlPassword } from "@/lib/secrets";
import { DEFAULT_PORTS, FILE_KINDS, PASSWORDLESS_KINDS } from "./products";
import type {
  ExternalConnection,
  ExternalImportCandidate,
  ExternalImportSummary,
  ImportedConnectionSecrets,
  ResolvedExternalImport,
} from "./types";

const SCHEMES: Partial<Record<DatabaseKind, string>> = {
  postgres: "postgresql",
  mysql: "mysql",
  mssql: "mssql",
  oracle: "oracle",
  clickhouse: "clickhouse",
  mongodb: "mongodb",
  redis: "redis",
  cassandra: "cassandra",
};

const SSL_MODES: SslMode[] = ["disable", "prefer", "require", "verify-ca", "verify-full"];

const ABSOLUTE_PATH = /^(\/|~\/|[A-Za-z]:[\\/]|\\\\)/;

function hostForUrl(host: string): string {
  const clean = host.trim().replace(/^\[|\]$/g, "");
  return clean.includes(":") ? `[${clean}]` : clean;
}

function folderTag(folder: string): ConnectionTag[] {
  const name = folder.trim();
  if (!name) return [];
  let hash = 0;
  for (let index = 0; index < name.length; index++)
    hash = (hash * 31 + name.charCodeAt(index)) >>> 0;
  return [{ name, color: TAG_COLORS[hash % TAG_COLORS.length] }];
}

function oracleDescriptor(connection: ExternalConnection, port: number): string {
  if (connection.oracleDescriptor) return connection.oracleDescriptor;
  return `(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=${connection.host})(PORT=${port}))(CONNECT_DATA=(SID=${connection.database})))`;
}

export function externalConnectionString(connection: ExternalConnection): string {
  const kind = connection.kind as DatabaseKind;
  if (FILE_KINDS.includes(kind)) return connection.database.trim();
  const scheme = connection.srv && kind === "mongodb" ? "mongodb+srv" : SCHEMES[kind];
  const user = connection.user || (connection.password && kind === "redis" ? "default" : "");
  const auth = user ? `${encodeURIComponent(user)}@` : "";
  const port = connection.port ?? DEFAULT_PORTS[kind] ?? null;
  const portPart = port && !connection.srv ? `:${port}` : "";
  const query = new URLSearchParams(connection.params);
  let path = connection.database ? `/${encodeURIComponent(connection.database)}` : "";
  if (kind === "oracle" && (connection.oracleSid || connection.oracleDescriptor)) {
    path = "/";
    query.set("connect_string", oracleDescriptor(connection, port ?? 1521));
  }
  const search = query.toString();
  return `${scheme}://${auth}${hostForUrl(connection.host)}${portPart}${path}${search ? `?${search}` : ""}`;
}

function sslModeOf(connection: ExternalConnection): SslMode {
  const mode = connection.params.find(([key]) => key.toLowerCase() === "sslmode")?.[1];
  return mode && SSL_MODES.includes(mode as SslMode) ? (mode as SslMode) : "prefer";
}

function sshProfile(connection: ExternalConnection, warnings: string[]): ExportedSsh | null {
  const ssh = connection.ssh;
  if (!ssh) return null;
  const missing: string[] = [];
  if (!ssh.user) missing.push("Benutzer");
  if (ssh.auth === "key" && !ssh.keyFile) missing.push("Schlüsseldatei");
  if (ssh.auth === "password" && !ssh.secret) missing.push("Passwort");
  if (missing.length) warnings.push(`SSH unvollständig: ${missing.join(", ")} fehlt.`);
  return {
    host: ssh.host,
    port: ssh.port,
    user: ssh.user,
    auth: ssh.auth,
    keyFile: ssh.keyFile,
    remoteHost: connection.host.replace(/^\[|\]$/g, ""),
    remotePort: connection.port ?? DEFAULT_PORTS[connection.kind as DatabaseKind] ?? 0,
  };
}

function skipReasonOf(connection: ExternalConnection): string | null {
  if (connection.issue) return connection.issue;
  if (!connection.kind)
    return `Nicht unterstützter Typ „${connection.driver || connection.product || "unbekannt"}“.`;
  if (FILE_KINDS.includes(connection.kind)) {
    if (!connection.database.trim()) return "Dateipfad fehlt.";
    return null;
  }
  if (connection.sshIssue) return connection.sshIssue;
  if (!connection.host.trim()) return "Host fehlt.";
  if (/[\s/?#@]/.test(connection.host.trim())) return `Ungültiger Host „${connection.host}“.`;
  if (connection.kind === "oracle" && !connection.database && !connection.oracleDescriptor)
    return "Service-Name oder SID fehlt.";
  if (
    connection.kind === "oracle" &&
    connection.ssh &&
    (connection.oracleSid || connection.oracleDescriptor)
  )
    return "Oracle mit SID oder TNS über SSH-Tunnel bitte manuell mit Service-Name anlegen.";
  return null;
}

export function endpointKey(kind: DatabaseKind, connectionString: string): string | null {
  const value = connectionString.trim();
  if (!value) return null;
  if (FILE_KINDS.includes(kind) || !value.includes("://"))
    return FILE_KINDS.includes(kind)
      ? `file|${value.replace(/^(sqlite|duckdb|file):(\/\/)?/i, "")}`
      : null;
  try {
    const url = new URL(value);
    const port = url.port || String(DEFAULT_PORTS[kind] ?? "");
    const database =
      decodeURIComponent(url.pathname.replace(/^\//, "")) ||
      url.searchParams.get("connect_string") ||
      "";
    return [
      url.hostname.replace(/^\[|\]$/g, "").toLowerCase(),
      port,
      database,
      decodeURIComponent(url.username),
    ].join("|");
  } catch {
    return null;
  }
}

function existingIndex(existing: SavedConnection[]): Map<string, SavedConnection> {
  const index = new Map<string, SavedConnection>();
  for (const connection of existing) {
    const key = endpointKey(connection.kind, connection.connectionString);
    if (key && !index.has(key)) index.set(key, connection);
  }
  return index;
}

function toCandidate(
  connection: ExternalConnection,
  index: number,
  known: Map<string, SavedConnection>,
): ExternalImportCandidate {
  const label = connection.name || `Eintrag ${index + 1}`;
  const base = {
    index,
    label,
    folder: connection.folder,
    product: connection.product || connection.driver || "unbekannt",
    kind: connection.kind,
  };
  const skipReason = skipReasonOf(connection);
  if (skipReason)
    return {
      ...base,
      endpoint: "",
      profile: null,
      password: null,
      sshSecret: null,
      skipReason,
      warnings: [],
      missingPassword: false,
      duplicateOf: null,
    };
  const kind = connection.kind as DatabaseKind;
  const warnings: string[] = [];
  const passwordless = PASSWORDLESS_KINDS.includes(kind);
  const password =
    !passwordless && connection.password && (connection.user || kind === "redis")
      ? connection.password
      : null;
  const missingPassword = !passwordless && Boolean(connection.user) && !password;
  if (missingPassword)
    warnings.push(connection.passwordHint ?? "Passwort fehlt, bitte nach dem Import ergänzen.");
  if (FILE_KINDS.includes(kind) && !ABSOLUTE_PATH.test(connection.database))
    warnings.push("Dateipfad ist relativ oder enthält Platzhalter, bitte prüfen.");
  if (!passwordless && !connection.user && ["postgres", "mysql", "mssql", "oracle"].includes(kind))
    warnings.push("Benutzer fehlt.");
  const ssh = sshProfile(connection, warnings);
  const connectionString = externalConnectionString(connection);
  const endpoint = endpointKey(kind, connectionString) ?? "";
  const profile: ExportedConnection = {
    id: createConnectionId(),
    name: label,
    kind,
    connectionString,
    sslMode: sslModeOf(connection),
    ssh,
    tags: folderTag(connection.folder),
    favorite: false,
    color: null,
    schemas: null,
    showSingleSchemaSwitcher: true,
    ...(connection.environment ? { environment: connection.environment } : {}),
    ...(connection.readOnly ? { readOnly: true } : {}),
  };
  return {
    ...base,
    endpoint,
    profile,
    password,
    sshSecret: ssh && ssh.auth !== "agent" ? (connection.ssh?.secret ?? null) : null,
    skipReason: null,
    warnings,
    missingPassword,
    duplicateOf: endpoint ? (known.get(endpoint) ?? null) : null,
  };
}

export function buildExternalCandidates(
  connections: ExternalConnection[],
  existing: SavedConnection[],
): ExternalImportCandidate[] {
  const known = existingIndex(existing);
  return connections.map((connection, index) => toCandidate(connection, index, known));
}

function savedConnection(
  candidate: ExternalImportCandidate,
  profile: ExportedConnection,
  id: string,
  name: string,
): SavedConnection {
  const live = candidate.password
    ? injectUrlPassword(profile.connectionString, candidate.password)
    : profile.connectionString;
  return {
    id,
    name,
    kind: profile.kind,
    connectionString: live,
    sslMode: profile.sslMode,
    ssh: profile.ssh ? { ...profile.ssh } : null,
    proxy: null,
    tunnelPort: null,
    tags: profile.tags.map((tag) => ({ ...tag })),
    favorite: false,
    color: null,
    schemas: null,
    showSingleSchemaSwitcher: true,
    ...(profile.environment ? { environment: profile.environment } : {}),
    ...(profile.readOnly ? { readOnly: true } : {}),
  };
}

export function resolveExternalImport(
  candidates: ExternalImportCandidate[],
  selected: ReadonlySet<number>,
  strategy: "skip" | "copy",
): ResolvedExternalImport {
  const connections: SavedConnection[] = [];
  const secrets: ImportedConnectionSecrets[] = [];
  const summary: ExternalImportSummary = { imported: 0, skipped: 0, missingPassword: 0 };
  for (const candidate of candidates) {
    const profile = candidate.profile;
    if (!profile || candidate.skipReason || !selected.has(candidate.index)) {
      summary.skipped++;
      continue;
    }
    if (candidate.duplicateOf && strategy === "skip") {
      summary.skipped++;
      continue;
    }
    const copy = Boolean(candidate.duplicateOf);
    const id = copy ? createConnectionId() : profile.id;
    const name = copy ? `${profile.name} (Kopie)` : profile.name;
    connections.push(savedConnection(candidate, profile, id, name));
    if (candidate.password || candidate.sshSecret)
      secrets.push({ id, password: candidate.password, sshSecret: candidate.sshSecret });
    summary.imported++;
    if (candidate.missingPassword) summary.missingPassword++;
  }
  return { connections, secrets, summary };
}

export async function persistImportedSecrets(
  secrets: ImportedConnectionSecrets[],
  store: (account: string, secret: string) => Promise<void>,
  sshAccount: (id: string) => string,
  concurrency = 4,
): Promise<number> {
  const jobs: Array<[string, string]> = [];
  for (const entry of secrets) {
    if (entry.password) jobs.push([entry.id, entry.password]);
    if (entry.sshSecret) jobs.push([sshAccount(entry.id), entry.sshSecret]);
  }
  let next = 0;
  let failed = 0;
  async function worker() {
    while (next < jobs.length) {
      const [account, secret] = jobs[next++];
      try {
        await store(account, secret);
      } catch {
        failed++;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
  return failed;
}
