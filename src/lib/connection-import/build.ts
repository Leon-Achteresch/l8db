import {
  type ExportedConnection,
  type ExportedSsh,
  keepRuleProduction,
} from "@/lib/connection-export";
import type { HostGroupRule } from "@/lib/connection-groups";
import {
  type ConnectionTag,
  createConnectionId,
  type SavedConnection,
  TAG_COLORS,
} from "@/lib/connections";
import type { DatabaseKind } from "@/lib/db";
import { injectUrlPassword } from "@/lib/secrets";
import { cloudTarget } from "./cloud";
import { endpointKey } from "./identity";
import { CLOUD_KINDS, FILE_KINDS, PASSWORDLESS_KINDS } from "./products";
import { type ResolvedTransport, resolveTransport } from "./transport";
import type {
  ExternalConnection,
  ExternalImportCandidate,
  ExternalImportSummary,
  ImportedConnectionSecrets,
  ResolvedExternalImport,
  SecretAccounts,
} from "./types";

const ABSOLUTE_PATH = /^(\/|~\/|[A-Za-z]:[\\/]|\\\\)/;

function effectiveUser(connection: ExternalConnection): string {
  if (connection.user) return connection.user;
  return connection.kind === "influxdb" && connection.password ? "token" : "";
}

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

export function externalConnectionString(
  connection: ExternalConnection,
  transport: ResolvedTransport | null,
): string {
  const kind = connection.kind as DatabaseKind;
  if (FILE_KINDS.includes(kind) || !transport) return connection.database.trim();
  const scheme =
    connection.srv && kind === "mongodb"
      ? "mongodb+srv"
      : kind === "elasticsearch" && connection.product === "OpenSearch"
        ? "opensearch"
        : transport.scheme;
  const user = effectiveUser(connection);
  const passwordOnly = !user && Boolean(connection.password) && kind === "redis";
  const auth = user ? `${encodeURIComponent(user)}@` : passwordOnly ? "@" : "";
  const portPart = transport.port && !connection.srv ? `:${transport.port}` : "";
  const query = new URLSearchParams(transport.params);
  let path = connection.database ? `/${encodeURIComponent(connection.database)}` : "";
  if (kind === "oracle" && (connection.oracleSid || connection.oracleDescriptor)) {
    path = "/";
    query.set("connect_string", oracleDescriptor(connection, transport.sshRemotePort || 1521));
  }
  const search = query.toString();
  return `${scheme}://${auth}${hostForUrl(connection.host)}${portPart}${path}${search ? `?${search}` : ""}`;
}

function sshProfile(
  connection: ExternalConnection,
  warnings: string[],
  remotePort: number,
): ExportedSsh | null {
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
    remotePort,
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
  if (CLOUD_KINDS.includes(connection.kind))
    return connection.ssh || connection.proxy
      ? "SSH-Tunnel oder Proxy für Cloud-Dienste wird beim Import nicht unterstützt."
      : null;
  if (!connection.host.trim()) return "Host fehlt.";
  if (/[\s/?#@\\]/.test(connection.host.trim())) return `Ungültiger Host „${connection.host}“.`;
  if (connection.kind === "oracle" && !connection.database && !connection.oracleDescriptor)
    return "Service-Name oder SID fehlt.";
  if (
    connection.kind === "oracle" &&
    (connection.ssh || connection.proxy) &&
    (connection.oracleSid || connection.oracleDescriptor)
  )
    return "Oracle mit SID oder TNS über SSH-Tunnel oder Proxy bitte manuell mit Service-Name anlegen.";
  return null;
}

function existingIndex(existing: SavedConnection[]): Map<string, SavedConnection> {
  const index = new Map<string, SavedConnection>();
  for (const connection of existing) {
    const key = endpointKey(
      connection.kind,
      connection.connectionString,
      connection.ssh,
      connection.proxy,
    );
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
  const sourceSkip = skipReasonOf(connection);
  const cloud =
    connection.kind && CLOUD_KINDS.includes(connection.kind) && !sourceSkip
      ? cloudTarget(connection)
      : null;
  const skipReason = sourceSkip ?? cloud?.skipReason ?? null;
  if (skipReason)
    return {
      ...base,
      endpoint: "",
      profile: null,
      password: null,
      sshSecret: null,
      proxySecret: null,
      skipReason,
      warnings: [],
      missingPassword: false,
      duplicateOf: null,
    };
  const kind = connection.kind as DatabaseKind;
  const warnings: string[] = [...(cloud?.warnings ?? [])];
  const passwordless = PASSWORDLESS_KINDS.includes(kind);
  const user = cloud ? cloud.user : effectiveUser(connection);
  const offered = cloud ? cloud.password : connection.password;
  const password = !passwordless && offered && (user || kind === "redis") ? offered : null;
  const missingPassword = cloud
    ? cloud.credentialsMissing
    : !passwordless && Boolean(user) && !password;
  if (missingPassword && !cloud)
    warnings.push(connection.passwordHint ?? "Passwort fehlt, bitte nach dem Import ergänzen.");
  if (FILE_KINDS.includes(kind) && !ABSOLUTE_PATH.test(connection.database))
    warnings.push("Dateipfad ist relativ oder enthält Platzhalter, bitte prüfen.");
  if (!passwordless && !connection.user && ["postgres", "mysql", "mssql", "oracle"].includes(kind))
    warnings.push("Benutzer fehlt.");
  const transport =
    FILE_KINDS.includes(kind) || cloud
      ? null
      : resolveTransport(kind, {
          params: connection.params,
          sslMode: connection.sslMode,
          urlScheme: connection.urlScheme,
          port: connection.port,
        });
  if (transport) warnings.push(...transport.warnings);
  if (transport?.stripped.length)
    warnings.push(
      `Geheime Parameter nicht übernommen, bitte im Profil ergänzen: ${transport.stripped.join(", ")}.`,
    );
  const ssh = sshProfile(connection, warnings, transport?.sshRemotePort ?? 0);
  const proxy = connection.proxy ? { ...connection.proxy } : null;
  if (proxy?.username && !connection.proxySecret) warnings.push("Proxy-Passwort fehlt.");
  const connectionString = cloud
    ? cloud.connectionString
    : externalConnectionString(connection, transport);
  const endpoint = endpointKey(kind, connectionString, ssh, proxy) ?? "";
  const profile: ExportedConnection = {
    id: createConnectionId(),
    name: label,
    kind,
    connectionString,
    sslMode: transport?.sslMode ?? "prefer",
    ssh,
    ...(proxy ? { proxy } : {}),
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
    proxySecret: proxy?.username ? connection.proxySecret : null,
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
    proxy: profile.proxy ? { ...profile.proxy } : null,
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

export type ImportDecision = "skip" | "import" | "copy";

export function importDecision(
  candidate: ExternalImportCandidate,
  selected: ReadonlySet<number>,
  strategy: "skip" | "copy",
): ImportDecision {
  if (!candidate.profile || candidate.skipReason || !selected.has(candidate.index)) return "skip";
  if (!candidate.duplicateOf) return "import";
  return strategy === "copy" ? "copy" : "skip";
}

export function countExternalImport(
  candidates: ExternalImportCandidate[],
  selected: ReadonlySet<number>,
  strategy: "skip" | "copy",
): number {
  let count = 0;
  for (const candidate of candidates)
    if (importDecision(candidate, selected, strategy) !== "skip") count++;
  return count;
}

export function resolveExternalImport(
  candidates: ExternalImportCandidate[],
  selected: ReadonlySet<number>,
  strategy: "skip" | "copy",
  rules?: HostGroupRule[],
): ResolvedExternalImport {
  const connections: SavedConnection[] = [];
  const secrets: ImportedConnectionSecrets[] = [];
  const summary: ExternalImportSummary = { imported: 0, skipped: 0, missingPassword: 0 };
  for (const candidate of candidates) {
    const decision = importDecision(candidate, selected, strategy);
    const profile = candidate.profile;
    if (decision === "skip" || !profile) {
      summary.skipped++;
      continue;
    }
    const copy = decision === "copy";
    const id = copy ? createConnectionId() : profile.id;
    const name = copy ? `${profile.name} (Kopie)` : profile.name;
    connections.push(keepRuleProduction(savedConnection(candidate, profile, id, name), rules));
    if (candidate.password || candidate.sshSecret || candidate.proxySecret)
      secrets.push({
        id,
        password: candidate.password,
        sshSecret: candidate.sshSecret,
        proxySecret: candidate.proxySecret,
      });
    summary.imported++;
    if (candidate.missingPassword) summary.missingPassword++;
  }
  return { connections, secrets, summary };
}

export async function persistImportedSecrets(
  secrets: ImportedConnectionSecrets[],
  store: (account: string, secret: string) => Promise<void>,
  accounts: SecretAccounts,
  concurrency = 4,
): Promise<number> {
  const jobs: Array<[string, string]> = [];
  for (const entry of secrets) {
    if (entry.password) jobs.push([entry.id, entry.password]);
    if (entry.sshSecret) jobs.push([accounts.ssh(entry.id), entry.sshSecret]);
    if (entry.proxySecret) jobs.push([accounts.proxy(entry.id), entry.proxySecret]);
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
