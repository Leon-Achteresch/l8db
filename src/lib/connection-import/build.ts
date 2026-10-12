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
import type { DatabaseKind, EndpointRequest, EndpointResult } from "@/lib/db";
import { injectUrlPassword } from "@/lib/secrets";
import { cloudTarget } from "./cloud";
import { fileKey, identityKey } from "./identity";
import { CLOUD_KINDS, FILE_KINDS, PASSWORDLESS_KINDS } from "./products";
import { type IntendedTransport, type ResolvedTransport, resolveTransport } from "./transport";
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
    query.set("connect_string", oracleDescriptor(connection, transport.port ?? 1521));
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

export type EndpointResolver = (requests: EndpointRequest[]) => Promise<EndpointResult[]>;

interface Draft {
  candidate: ExternalImportCandidate;
  intended: IntendedTransport | null;
}

function resolvable(kind: DatabaseKind): boolean {
  return !FILE_KINDS.includes(kind);
}

function mismatch(intended: IntendedTransport, result: EndpointResult): string | null {
  const identity = result.identity;
  if (!identity) return `l8db kann die erzeugte URL nicht lesen: ${result.error ?? "unbekannt"}.`;
  if (intended.tls !== null && identity.tls !== intended.tls)
    return intended.tls
      ? "l8db würde diese Verbindung ohne TLS aufbauen. Bitte manuell anlegen."
      : "l8db würde diese Verbindung mit TLS aufbauen, die Quelle aber ohne. Bitte manuell anlegen.";
  if (intended.verify === true && !identity.verify)
    return "l8db würde das Zertifikat nicht prüfen, die Quelle schon. Bitte manuell anlegen.";
  if (intended.port !== null && identity.port !== intended.port)
    return `l8db würde Port ${identity.port ?? "?"} statt ${intended.port} verwenden. Bitte manuell anlegen.`;
  return null;
}

function skipped(candidate: ExternalImportCandidate, reason: string): ExternalImportCandidate {
  return {
    ...candidate,
    endpoint: "",
    profile: null,
    password: null,
    sshSecret: null,
    proxySecret: null,
    skipReason: reason,
    warnings: [],
    missingPassword: false,
    duplicateOf: null,
  };
}

function toDraft(connection: ExternalConnection, index: number): Draft {
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
  const needsTransport =
    !sourceSkip && connection.kind && !cloud && !FILE_KINDS.includes(connection.kind);
  const transport = needsTransport
    ? resolveTransport(connection.kind as DatabaseKind, {
        params: connection.params,
        sslMode: connection.sslMode,
        urlScheme: connection.urlScheme,
        portFromUrl: connection.portFromUrl,
        port: connection.port,
      })
    : null;
  const missingAdapter =
    needsTransport && !transport
      ? `Für den Typ „${connection.kind}“ fehlt die Import-Zuordnung.`
      : null;
  const skipReason = sourceSkip ?? cloud?.skipReason ?? missingAdapter;
  if (skipReason)
    return {
      candidate: skipped(
        {
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
        },
        skipReason,
      ),
      intended: null,
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
  if (transport) warnings.push(...transport.warnings);
  if (transport?.stripped.length)
    warnings.push(
      `Geheime Parameter nicht übernommen, bitte im Profil ergänzen: ${transport.stripped.join(", ")}.`,
    );
  const ssh = sshProfile(connection, warnings, transport?.port ?? 0);
  const proxy = connection.proxy ? { ...connection.proxy } : null;
  if (proxy?.username && !connection.proxySecret) warnings.push("Proxy-Passwort fehlt.");
  const connectionString = cloud
    ? cloud.connectionString
    : externalConnectionString(connection, transport);
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
    candidate: {
      ...base,
      endpoint: FILE_KINDS.includes(kind) ? fileKey(connectionString) : "",
      profile,
      password,
      sshSecret: ssh && ssh.auth !== "agent" ? (connection.ssh?.secret ?? null) : null,
      proxySecret: proxy?.username ? connection.proxySecret : null,
      skipReason: null,
      warnings,
      missingPassword,
      duplicateOf: null,
    },
    intended: transport
      ? {
          ...transport.intended,
          port:
            kind === "oracle" && (connection.oracleSid || connection.oracleDescriptor)
              ? null
              : transport.intended.port,
        }
      : { tls: null, verify: null, port: null },
  };
}

interface Plan {
  drafts: Draft[];
  existing: SavedConnection[];
  existingRequests: SavedConnection[];
  pending: Draft[];
  requests: EndpointRequest[];
}

function plan(connections: ExternalConnection[], existing: SavedConnection[]): Plan {
  const drafts = connections.map((connection, index) => toDraft(connection, index));
  const existingRequests = existing.filter((connection) => resolvable(connection.kind));
  const pending = drafts.filter(
    (draft) => draft.candidate.profile && resolvable(draft.candidate.profile.kind),
  );
  const requests: EndpointRequest[] = [
    ...existingRequests.map((connection) => ({
      kind: connection.kind,
      url: connection.connectionString,
    })),
    ...pending.map((draft) => {
      const profile = draft.candidate.profile as ExportedConnection;
      return { kind: profile.kind, url: profile.connectionString };
    }),
  ];
  return { drafts, existing, existingRequests, pending, requests };
}

function finish(planned: Plan, results: EndpointResult[]): ExternalImportCandidate[] {
  const known = new Map<string, SavedConnection>();
  const remember = (key: string, connection: SavedConnection) => {
    if (!known.has(key)) known.set(key, connection);
  };
  for (const connection of planned.existing)
    if (FILE_KINDS.includes(connection.kind))
      remember(fileKey(connection.connectionString), connection);
  planned.existingRequests.forEach((connection, position) => {
    const identity = results[position]?.identity;
    if (identity)
      remember(
        identityKey(connection.kind, identity, connection.ssh, connection.proxy),
        connection,
      );
  });
  const resolved = new Map<Draft, EndpointResult>();
  planned.pending.forEach((draft, position) => {
    resolved.set(
      draft,
      results[planned.existingRequests.length + position] ?? {
        identity: null,
        error: "keine Antwort",
      },
    );
  });
  return planned.drafts.map((draft) => {
    const candidate = draft.candidate;
    const profile = candidate.profile;
    if (!profile) return candidate;
    const result = resolved.get(draft);
    if (!result) return { ...candidate, duplicateOf: known.get(candidate.endpoint) ?? null };
    const problem = draft.intended ? mismatch(draft.intended, result) : null;
    if (problem || !result.identity) return skipped(candidate, problem ?? "");
    const identity = result.identity;
    const ssh = profile.ssh ? { ...profile.ssh, remotePort: identity.port ?? 0 } : null;
    const endpoint = identityKey(profile.kind, identity, ssh, profile.proxy);
    return {
      ...candidate,
      profile: { ...profile, ssh },
      endpoint,
      duplicateOf: known.get(endpoint) ?? null,
    };
  });
}

export function buildExternalCandidatesWith(
  connections: ExternalConnection[],
  existing: SavedConnection[],
  lookup: (requests: EndpointRequest[]) => EndpointResult[],
): ExternalImportCandidate[] {
  const planned = plan(connections, existing);
  return finish(planned, planned.requests.length ? lookup(planned.requests) : []);
}

export async function buildExternalCandidates(
  connections: ExternalConnection[],
  existing: SavedConnection[],
  resolve: EndpointResolver,
): Promise<ExternalImportCandidate[]> {
  const planned = plan(connections, existing);
  return finish(planned, planned.requests.length ? await resolve(planned.requests) : []);
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
