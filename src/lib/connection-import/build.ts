import {
  type ExportedConnection,
  type ExportedSsh,
  keepRuleProduction,
} from "@/lib/connection-export";
import type { HostGroupRule } from "@/lib/connection-groups";
import {
  type ConnectionTag,
  createConnectionId,
  type NetworkProxy,
  type SavedConnection,
  type SshConnection,
  TAG_COLORS,
} from "@/lib/connections";
import type { DatabaseKind, SslMode } from "@/lib/db";
import { injectUrlPassword } from "@/lib/secrets";
import { cloudTarget } from "./cloud";
import { CLOUD_KINDS, DEFAULT_PORTS, FILE_KINDS, PASSWORDLESS_KINDS } from "./products";
import type {
  ExternalConnection,
  ExternalImportCandidate,
  ExternalImportSummary,
  ImportedConnectionSecrets,
  ResolvedExternalImport,
  SecretAccounts,
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
  elasticsearch: "elasticsearch",
  influxdb: "influxdb",
};

const HTTP_TLS_KINDS: DatabaseKind[] = ["clickhouse", "elasticsearch", "influxdb"];

const SSL_MODES: SslMode[] = ["disable", "prefer", "require", "verify-ca", "verify-full"];

const SSL_PARAM_KINDS: DatabaseKind[] = ["postgres", "mysql", "mssql", "cassandra"];

const INSECURE_KEYS = [
  "insecure",
  "tls_insecure",
  "skip_verify",
  "sslinsecure",
  "trustallcertificates",
];

const VERIFY_KEYS = [
  "verify",
  "ssl_verify",
  "sslverify",
  "verify_ssl",
  "verifyservercertificate",
  "verify_server_certificate",
  "sslverification",
  "ssl.verify.server",
];

const SECRET_LIKE =
  /pass(word|phrase)?|pwd|secret|token|credential|api[_-]?key|private[_-]?key|access[_-]?key/i;

const MSSQL_PARAMS: Record<string, string> = {
  instancename: "instance",
  instance: "instance",
  trustservercertificate: "trust_server_certificate",
  trust_server_certificate: "trust_server_certificate",
  integratedsecurity: "integrated_security",
  integrated_security: "integrated_security",
  applicationname: "application_name",
};

const MYSQL_SSL_MODES: Record<string, SslMode> = {
  disabled: "disable",
  preferred: "prefer",
  required: "require",
  verify_ca: "verify-ca",
  verify_identity: "verify-full",
};

const ABSOLUTE_PATH = /^(\/|~\/|[A-Za-z]:[\\/]|\\\\)/;

const TRUE_VALUES = ["true", "1", "yes", "on"];

const FALSE_VALUES = ["false", "0", "no", "off"];

interface PreparedParams {
  params: Array<[string, string]>;
  sslMode: SslMode;
  stripped: string[];
  secure: boolean | null;
  warnings: string[];
}

const SECURE_MODES: SslMode[] = ["require", "verify-ca", "verify-full"];

const CLOUD_KEY_PARAMS = ["profile", "workgroup", "endpoint", "catalog"];

function flag(value: string): boolean | null {
  const normalized = value.trim().toLowerCase();
  if (TRUE_VALUES.includes(normalized)) return true;
  if (FALSE_VALUES.includes(normalized)) return false;
  return null;
}

function libpqMode(value: string): SslMode | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === "allow") return "prefer";
  return SSL_MODES.includes(normalized as SslMode) ? (normalized as SslMode) : null;
}

function mssqlEncryptMode(value: string, trust: boolean): SslMode {
  const normalized = value.trim().toLowerCase();
  if (["false", "no", "0", "disable", "disabled"].includes(normalized)) return "disable";
  if (normalized === "optional") return "prefer";
  return trust ? "require" : "verify-full";
}

export function prepareParams(connection: ExternalConnection): PreparedParams {
  const kind = connection.kind as DatabaseKind;
  const params: Array<[string, string]> = [];
  const stripped: string[] = [];
  let explicit: SslMode | null = null;
  let derived: SslMode | null = null;
  let pgSsl: boolean | null = null;
  let pgFactory = "";
  let mysqlVerify = false;
  let mssqlEncrypt: string | null = null;
  let mssqlTrust = false;
  for (const [rawKey, value] of connection.params) {
    const key = rawKey.trim();
    const lower = key.toLowerCase();
    if (SECRET_LIKE.test(key)) {
      stripped.push(key);
      continue;
    }
    if (lower === "sslmode") {
      explicit = libpqMode(value) ?? MYSQL_SSL_MODES[value.trim().toLowerCase()] ?? explicit;
      continue;
    }
    if (kind === "postgres") {
      if (lower === "ssl") {
        pgSsl = flag(value) ?? true;
        continue;
      }
      if (lower === "sslfactory") {
        pgFactory = value;
        continue;
      }
    }
    if (kind === "mysql") {
      if (lower === "ssl-mode" || lower === "ssl_mode") {
        explicit = MYSQL_SSL_MODES[value.trim().toLowerCase()] ?? explicit;
        continue;
      }
      if (lower === "usessl" || lower === "requiressl") {
        const enabled = flag(value);
        if (enabled === false && lower === "usessl") derived = "disable";
        else if (enabled) derived = derived === "disable" ? derived : "require";
        continue;
      }
      if (lower === "verifyservercertificate") {
        mysqlVerify = flag(value) === true;
        continue;
      }
    }
    if (kind === "mssql") {
      if (lower === "encrypt") {
        mssqlEncrypt = value;
        continue;
      }
      const mapped = MSSQL_PARAMS[lower];
      if (mapped === "trust_server_certificate") mssqlTrust = flag(value) === true;
      if (mapped) {
        params.push([mapped, value]);
        continue;
      }
    }
    params.push([key, value]);
  }
  if (kind === "postgres" && pgSsl !== null)
    derived = !pgSsl
      ? "disable"
      : /NonValidatingFactory/i.test(pgFactory)
        ? "require"
        : "verify-full";
  if (kind === "mysql" && derived === "require" && mysqlVerify) derived = "verify-ca";
  if (kind === "mssql" && mssqlEncrypt !== null)
    derived = mssqlEncryptMode(mssqlEncrypt, mssqlTrust);
  const sslMode = explicit ?? connection.sslMode ?? derived ?? "prefer";
  if (SSL_PARAM_KINDS.includes(kind)) params.push(["sslmode", sslMode]);
  if (HTTP_TLS_KINDS.includes(kind)) return httpTlsParams(kind, params, sslMode, stripped);
  const secure = SECURE_MODES.includes(sslMode) ? true : sslMode === "disable" ? false : null;
  const warnings: string[] = [];
  if (kind === "mongodb" && secure && !params.some(([key]) => /^(tls|ssl)$/i.test(key))) {
    params.push(["tls", "true"]);
    if (sslMode === "require") params.push(["tlsAllowInvalidCertificates", "true"]);
  }
  if (kind === "redis" && secure && sslMode === "require")
    warnings.push("Zertifikatsprüfung war in der Quelle aus, l8db prüft das Zertifikat.");
  return { params, sslMode, stripped, secure, warnings };
}

const TLS_KEYS = ["ssl", "secure", "tls", "usessl"];

function httpTlsParams(
  kind: DatabaseKind,
  params: Array<[string, string]>,
  sslMode: SslMode,
  stripped: string[],
): PreparedParams {
  const keyOf = (key: string) => key.toLowerCase();
  const kept = params.filter(
    ([key]) =>
      !TLS_KEYS.includes(keyOf(key)) &&
      !INSECURE_KEYS.includes(keyOf(key)) &&
      !VERIFY_KEYS.includes(keyOf(key)),
  );
  const values = (keys: string[]) =>
    params.filter(([key]) => keys.includes(keyOf(key))).map(([, value]) => flag(value));
  const flags = values(TLS_KEYS);
  const secure =
    flags.includes(true) || SECURE_MODES.includes(sslMode)
      ? true
      : flags.includes(false) || sslMode === "disable"
        ? false
        : null;
  const verificationOff =
    Boolean(secure) &&
    (sslMode === "require" ||
      values(INSECURE_KEYS).includes(true) ||
      values(VERIFY_KEYS).includes(false));
  const warnings: string[] = [];
  if (secure !== null)
    kept.push(kind === "clickhouse" ? ["secure", secure ? "1" : "0"] : ["ssl", String(secure)]);
  if (verificationOff && kind === "clickhouse")
    warnings.push(
      "Zertifikatsprüfung war in der Quelle aus, l8db prüft das ClickHouse-Zertifikat.",
    );
  else if (verificationOff) {
    kept.push(["insecure", "true"]);
    warnings.push("Zertifikatsprüfung ist aus, wie in der Quelle eingestellt.");
  }
  return {
    params: kept,
    sslMode: !secure
      ? sslMode
      : verificationOff
        ? "require"
        : sslMode === "prefer"
          ? "verify-full"
          : sslMode,
    stripped,
    secure,
    warnings,
  };
}

export function defaultPort(kind: DatabaseKind, secure: boolean | null): number | null {
  if (kind === "clickhouse") return secure ? 8443 : 8123;
  if (secure && HTTP_TLS_KINDS.includes(kind)) return null;
  return DEFAULT_PORTS[kind] ?? null;
}

function remotePortOf(connection: ExternalConnection, secure: boolean | null): number {
  const kind = connection.kind as DatabaseKind;
  return connection.port ?? defaultPort(kind, secure) ?? (secure ? 443 : 0);
}

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
  params: Array<[string, string]> = connection.params,
  secure: boolean | null = null,
): string {
  const kind = connection.kind as DatabaseKind;
  if (FILE_KINDS.includes(kind)) return connection.database.trim();
  const scheme =
    connection.srv && kind === "mongodb"
      ? "mongodb+srv"
      : kind === "elasticsearch" && connection.product === "OpenSearch"
        ? "opensearch"
        : kind === "redis" && secure
          ? "rediss"
          : SCHEMES[kind];
  const user = effectiveUser(connection);
  const passwordOnly = !user && Boolean(connection.password) && kind === "redis";
  const auth = user ? `${encodeURIComponent(user)}@` : passwordOnly ? "@" : "";
  const port = connection.port ?? defaultPort(kind, secure);
  const portPart = port && !connection.srv ? `:${port}` : "";
  const query = new URLSearchParams(params);
  let path = connection.database ? `/${encodeURIComponent(connection.database)}` : "";
  if (kind === "oracle" && (connection.oracleSid || connection.oracleDescriptor)) {
    path = "/";
    query.set("connect_string", oracleDescriptor(connection, port ?? 1521));
  }
  const search = query.toString();
  return `${scheme}://${auth}${hostForUrl(connection.host)}${portPart}${path}${search ? `?${search}` : ""}`;
}

function sshProfile(
  connection: ExternalConnection,
  warnings: string[],
  secure: boolean | null,
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
    remotePort: remotePortOf(connection, secure),
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

function networkKey(
  ssh: Pick<SshConnection, "host" | "port" | "user"> | null | undefined,
  proxy: NetworkProxy | null | undefined,
): string {
  const tunnel = ssh?.host ? `ssh:${ssh.host.toLowerCase()}:${ssh.port}:${ssh.user}` : "direct";
  const via = proxy?.host
    ? `proxy:${proxy.type}:${proxy.host.toLowerCase()}:${proxy.port}:${proxy.username ?? ""}`
    : "";
  return via ? `${tunnel}|${via}` : tunnel;
}

export function endpointKey(
  kind: DatabaseKind,
  connectionString: string,
  ssh?: Pick<SshConnection, "host" | "port" | "user"> | null,
  proxy?: NetworkProxy | null,
): string | null {
  const value = connectionString.trim();
  if (!value) return null;
  const network = networkKey(ssh, proxy);
  if (FILE_KINDS.includes(kind) || !value.includes("://"))
    return FILE_KINDS.includes(kind)
      ? `file|${value.replace(/^(sqlite|duckdb|file):(\/\/)?/i, "")}`
      : null;
  try {
    const url = new URL(value);
    const secure = ["secure", "ssl", "tls"].some((key) =>
      ["1", "true", "yes"].includes((url.searchParams.get(key) ?? "").toLowerCase()),
    );
    const port = url.port || String(defaultPort(kind, secure) ?? (secure ? 443 : ""));
    const database =
      decodeURIComponent(url.pathname.replace(/^\//, "")) ||
      url.searchParams.get("connect_string") ||
      "";
    const parts = [
      url.hostname.replace(/^\[|\]$/g, "").toLowerCase(),
      port,
      database,
      decodeURIComponent(url.username),
      network,
    ];
    if (CLOUD_KINDS.includes(kind))
      parts.push(
        CLOUD_KEY_PARAMS.map((key) => `${key}=${url.searchParams.get(key) ?? ""}`).join(","),
      );
    return parts.join("|");
  } catch {
    return null;
  }
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
  const prepared: PreparedParams =
    FILE_KINDS.includes(kind) || cloud
      ? { params: [], sslMode: "prefer", stripped: [], secure: null, warnings: [] }
      : prepareParams(connection);
  warnings.push(...prepared.warnings);
  if (prepared.stripped.length)
    warnings.push(
      `Geheime Parameter nicht übernommen, bitte im Profil ergänzen: ${prepared.stripped.join(", ")}.`,
    );
  const ssh = sshProfile(connection, warnings, prepared.secure);
  const proxy = connection.proxy ? { ...connection.proxy } : null;
  if (proxy?.username && !connection.proxySecret) warnings.push("Proxy-Passwort fehlt.");
  const connectionString = cloud
    ? cloud.connectionString
    : externalConnectionString(connection, prepared.params, prepared.secure);
  const endpoint = endpointKey(kind, connectionString, ssh, proxy) ?? "";
  const profile: ExportedConnection = {
    id: createConnectionId(),
    name: label,
    kind,
    connectionString,
    sslMode: prepared.sslMode,
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
