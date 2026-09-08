import type { DatabaseKind, ProviderInfo, SslMode } from "@/lib/db";
import { allProviders, FALLBACK_PROVIDERS, providerById, providerForKind } from "@/lib/providers";

const SSL_MODES = ["disable", "prefer", "require", "verify-ca", "verify-full"];
const PATH_LIKE = /^(\/|~\/|\.{1,2}\/|[A-Za-z]:[\\/]|:memory:$)/;
const USER_REQUIRED: DatabaseKind[] = ["postgres", "mysql", "mssql", "oracle"];
const DATABASE_REQUIRED: DatabaseKind[] = ["postgres", "oracle"];
const SSLMODE_PARAM: DatabaseKind[] = ["postgres", "mysql", "mssql"];
const ORACLE_USER_KEYS = ["userid", "uid", "username", "user"];
const ORACLE_PASSWORD_KEYS = ["password", "pwd"];
const ORACLE_SOURCE_KEYS = ["datasource"];
const NON_ORACLE_KEYS = [
  "initialcatalog",
  "database",
  "integratedsecurity",
  "trustedconnection",
  "trustservercertificate",
  "encrypt",
  "server",
];

export interface OracleKeyValue {
  user: string;
  password: string;
  source: string;
}

interface OracleEndpoint {
  host: string;
  port: string;
  service: string;
}

function splitOraclePairs(value: string): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  let key = "";
  let current = "";
  let inKey = true;
  let quote: string | null = null;
  const flush = () => {
    pairs.push([key, current]);
    key = "";
    current = "";
    inKey = true;
  };
  for (const char of value) {
    if (char === '"' || char === "'") {
      quote = quote === char ? null : (quote ?? char);
      current += char;
    } else if (char === ";" && !quote) {
      flush();
    } else if (char === "=" && inKey) {
      inKey = false;
    } else if (inKey) {
      key += char;
    } else {
      current += char;
    }
  }
  flush();
  return pairs;
}

function unquoteOracle(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'"))
      return trimmed.slice(1, -1);
  }
  return trimmed;
}

const compactOracleKey = (key: string) => key.trim().toLowerCase().replace(/\s+/g, "");

export function parseOracleKeyValue(value: string): OracleKeyValue | null {
  const trimmed = value.trim();
  if (!trimmed.includes("=") || !trimmed.includes(";")) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) || PATH_LIKE.test(trimmed)) return null;
  const raw = splitOraclePairs(trimmed).filter(([key, val]) => key.trim() || val.trim());
  if (raw.length < 2) return null;
  let user = "";
  let password = "";
  let source = "";
  let sawUser = false;
  let sawSource = false;
  for (const [rawKey, rawVal] of raw) {
    const key = compactOracleKey(rawKey);
    if (!key) return null;
    if (NON_ORACLE_KEYS.includes(key)) return null;
    if (ORACLE_USER_KEYS.includes(key)) {
      user = unquoteOracle(rawVal);
      sawUser = true;
    } else if (ORACLE_PASSWORD_KEYS.includes(key)) {
      password = unquoteOracle(rawVal);
    } else if (ORACLE_SOURCE_KEYS.includes(key)) {
      source = unquoteOracle(rawVal);
      sawSource = true;
    }
  }
  if (!sawSource || !sawUser) return null;
  return { user, password, source };
}

function oracleSourceIsOracleLike(source: string): boolean {
  const trimmed = source.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith("(") || trimmed.startsWith("/")) return true;
  if (trimmed.includes("/")) return true;
  if (/^\[[^\]]+\](?::\d+)?(?::|\/)/.test(trimmed)) return true;
  if (/:[0-9]{1,5}\//.test(trimmed) || /:[0-9]{1,5}:/.test(trimmed)) return true;
  return /service_name|sid\s*=|description\s*=/i.test(trimmed);
}

export function isOracleKeyValue(value: string): boolean {
  const parsed = parseOracleKeyValue(value);
  return parsed !== null && oracleSourceIsOracleLike(parsed.source);
}

function checkOraclePort(port: string): void {
  const num = Number(port);
  if (!/^\d+$/.test(port) || !Number.isInteger(num) || num < 1 || num > 65535)
    throw new Error("Der Port muss zwischen 1 und 65535 liegen.");
}

function parseOracleEndpoint(source: string): OracleEndpoint | null {
  const rest = source.trim().replace(/^\/\//, "");
  if (!rest || rest.startsWith("(")) return null;
  let head = rest;
  let service = "";
  const slash = rest.lastIndexOf("/");
  if (slash >= 0) {
    head = rest.slice(0, slash);
    service = rest.slice(slash + 1);
  } else {
    const parts = rest.split(":");
    if (parts.length !== 3) return null;
    head = `${parts[0]}:${parts[1]}`;
    service = parts[2];
  }
  head = head.trim();
  service = service.trim();
  if (!head || !service || /[\s()/]/.test(service)) return null;
  let host = head;
  let port = "";
  const ipv6 = /^\[([^\]]+)\](?::(\d+))?$/.exec(head);
  if (ipv6) {
    host = ipv6[1];
    port = ipv6[2] ?? "";
  } else {
    const colon = head.lastIndexOf(":");
    if (colon >= 0) {
      const candidate = head.slice(colon + 1);
      if (!/^\d+$/.test(candidate)) return null;
      host = head.slice(0, colon).trim();
      port = candidate;
    }
  }
  if (!host || /[\s()/]/.test(host)) return null;
  if (port) checkOraclePort(port);
  return { host, port, service };
}

function endpointFromTnsDescriptor(source: string): OracleEndpoint | null {
  if (!source.trim().startsWith("(")) return null;
  const host = /host\s*=\s*([^()=\s]+)/i.exec(source)?.[1];
  const port = /port\s*=\s*(\d+)/i.exec(source)?.[1] ?? "";
  const service =
    /service_name\s*=\s*([^()=\s]+)/i.exec(source)?.[1] ??
    /sid\s*=\s*([^()=\s]+)/i.exec(source)?.[1] ??
    "";
  if (!host || !service) return null;
  if (port) checkOraclePort(port);
  return { host, port, service };
}

function oracleEndpointHost(source: string): string {
  try {
    return parseOracleEndpoint(source)?.host ?? endpointFromTnsDescriptor(source)?.host ?? "";
  } catch {
    return "";
  }
}

export function oracleKeyValueToUrl(value: string): string {
  const parsed = parseOracleKeyValue(value);
  if (!parsed)
    throw new Error(
      "Gib eine gültige Oracle-Verbindung an, z. B. User Id=scott;Password=tiger;Data Source=host:1521/service.",
    );
  const user = parsed.user.trim();
  const source = parsed.source.trim();
  if (!user) throw new Error("Die Benutzerkennung (User Id) fehlt in der Oracle-Verbindung.");
  if (!source)
    throw new Error(
      "Die Data Source fehlt in der Oracle-Verbindung, z. B. Data Source=host:1521/service.",
    );
  const auth = `${encodeURIComponent(user)}${parsed.password ? `:${encodeURIComponent(parsed.password)}` : ""}@`;
  const endpoint = parseOracleEndpoint(source) ?? endpointFromTnsDescriptor(source);
  if (endpoint?.service) {
    const port = endpoint.port ? `:${endpoint.port}` : "";
    return `oracle://${auth}${endpoint.host}${port}/${encodeURIComponent(endpoint.service)}`;
  }
  const aliasHost = /^[A-Za-z0-9._-]+$/.test(source) ? source : "tns";
  const url = new URL(`oracle://${auth}${aliasHost}/?connect_string=${encodeURIComponent(source)}`);
  return url.toString();
}

export function oracleConnectString(url: URL): string | null {
  return url.searchParams.get("connect_string") ?? url.searchParams.get("tns");
}

interface OracleHostInput {
  hostname: string;
  port: string | null;
}

function parseOracleHostInput(host: string): OracleHostInput {
  const trimmed = host.trim();
  if (!trimmed) throw new Error("Der Host ist erforderlich.");
  let hostname = trimmed;
  let port: string | null = null;
  if (trimmed.startsWith("[")) {
    const match = /^\[([^\]]+)\](?::(\d+))?$/.exec(trimmed);
    if (!match) throw new Error("Der Host enthält eine ungültige IPv6-Adresse oder Portangabe.");
    hostname = match[1];
    port = match[2] ?? null;
  } else {
    const match = /^([^:]+):(\d+)$/.exec(trimmed);
    if (match) {
      hostname = match[1];
      port = match[2];
    }
  }
  if (!hostname || /[^\w.:-]/.test(hostname) || hostname.includes("@")) {
    throw new Error("Der Host enthält ungültige Zeichen.");
  }
  if (hostname.includes(":") && !/^[0-9a-f:.]+$/i.test(hostname)) {
    throw new Error("Der Host enthält eine ungültige IPv6-Adresse.");
  }
  if (port) checkOraclePort(port);
  return {
    hostname: hostname.includes(":") ? `[${hostname}]` : hostname,
    port,
  };
}

export function normalizeOracleHost(host: string): string {
  return parseOracleHostInput(host).hostname;
}

export function updateOracleConnectionEndpoint(
  value: string,
  host: string,
  serviceName: string,
): string {
  const { hostname, port } = parseOracleHostInput(host);
  const service = serviceName.trim();
  if (!service) throw new Error("Der Service-Name ist erforderlich.");
  if (/[\s/?#]/.test(service)) {
    throw new Error("Der Service-Name darf keine Leerzeichen oder URL-Trenner enthalten.");
  }
  const url = parseConnectionUrl(value, "oracle");
  url.hostname = hostname;
  if (port) url.port = port;
  url.pathname = `/${encodeURIComponent(service)}`;
  url.searchParams.delete("connect_string");
  url.searchParams.delete("tns");
  return parseConnectionUrl(url.toString(), "oracle").toString();
}

export function kindFromUrl(value: string): DatabaseKind | undefined {
  const trimmed = value.trim();
  if (PATH_LIKE.test(trimmed)) return /\.(duckdb|ddb)$/i.test(trimmed) ? "duckdb" : "sqlite";
  if (isOracleKeyValue(trimmed)) return "oracle";
  const match = /^([a-z][a-z0-9+.-]*):/i.exec(trimmed);
  if (!match) return undefined;
  const scheme = match[1].toLowerCase();
  return allProviders().find((provider) => provider.url_schemes.includes(scheme))?.kind;
}

export function filePath(value: string): string {
  const stripped = value.trim().replace(/^(sqlite|duckdb|file):(\/\/)?/i, "");
  try {
    return decodeURIComponent(stripped);
  } catch {
    return stripped;
  }
}

function parseFileUrl(value: string, kind: DatabaseKind): URL {
  const path = filePath(value).replace(/\\/g, "/");
  if (!path) throw new Error("Gib den Pfad zur Datenbankdatei an.");
  if (path !== ":memory:" && !PATH_LIKE.test(path))
    throw new Error("Gib einen absoluten Pfad zur Datenbankdatei an.");
  return new URL(`${kind}:${path}`);
}

export function parseConnectionUrl(value: string, kind = kindFromUrl(value)): URL {
  let text = value.trim();
  let resolved = kind;
  if (!/:\/\//.test(text) && text.includes("=")) {
    if (resolved === undefined && isOracleKeyValue(text)) resolved = "oracle";
    if (resolved === "oracle") text = oracleKeyValueToUrl(text);
  }
  if (!resolved) throw new Error("Gib eine gültige Verbindungs-URL ein, z. B. postgresql://…");
  const info = providerForKind(resolved);
  if (info?.file_based) return parseFileUrl(text, resolved);
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new Error("Gib eine gültige Verbindungs-URL ein.");
  }
  const override = resolved === "oracle" ? oracleConnectString(url) : null;
  const schemes = info?.url_schemes ?? [resolved];
  if (!schemes.includes(url.protocol.slice(0, -1).toLowerCase()))
    throw new Error(
      `Die URL muss mit ${schemes.map((scheme) => `${scheme}://`).join(" oder ")} beginnen.`,
    );
  if (!url.hostname) throw new Error("Der Host fehlt in der URL.");
  if (USER_REQUIRED.includes(resolved) && !url.username)
    throw new Error("Der Benutzer fehlt in der URL.");
  if (DATABASE_REQUIRED.includes(resolved) && (!url.pathname || url.pathname === "/") && !override)
    throw new Error(
      resolved === "oracle"
        ? "Der Service-Name fehlt in der URL."
        : "Der Datenbankname fehlt in der URL.",
    );
  if (resolved === "postgres") {
    for (const key of ["host", "hostaddr", "port", "user", "password", "dbname"]) {
      if (url.searchParams.has(key))
        throw new Error(
          `Setze ${key} direkt in der URL oder über die einzelnen Felder, nicht als URL-Parameter.`,
        );
    }
  }
  if (SSLMODE_PARAM.includes(resolved)) {
    const ssl = url.searchParams.get("sslmode");
    if (ssl && !SSL_MODES.includes(ssl))
      throw new Error("Der SSL-Modus in der URL wird nicht unterstützt.");
  }
  if (url.hash)
    throw new Error(
      "Sonderzeichen im Passwort müssen URL-kodiert sein. Nutze dafür die einzelnen Felder.",
    );
  if (
    url.port &&
    (!Number.isInteger(Number(url.port)) || Number(url.port) < 1 || Number(url.port) > 65535)
  )
    throw new Error("Der Port muss zwischen 1 und 65535 liegen.");
  for (const part of [url.username, url.password, url.pathname]) {
    try {
      decodeURIComponent(part);
    } catch {
      throw new Error("Die URL enthält eine ungültige Zeichenkodierung.");
    }
  }
  return url;
}

export function sslModeFromUrl(value: string): SslMode {
  try {
    const mode = new URL(value.trim()).searchParams.get("sslmode");
    if (mode && SSL_MODES.includes(mode)) return mode as SslMode;
  } catch {
    return "prefer";
  }
  return "prefer";
}

export function detectProvider(value: string, kind = kindFromUrl(value)): string {
  const candidates = allProviders().filter((provider) => provider.kind === (kind ?? "postgres"));
  if (!candidates.length) return "postgres";
  let host = "";
  const oracle = parseOracleKeyValue(value);
  if (oracle) {
    host = oracleEndpointHost(oracle.source).toLowerCase();
  } else {
    try {
      host = new URL(value.trim()).hostname.toLowerCase();
    } catch {
      host = "";
    }
  }
  const match = candidates.find((provider) =>
    provider.hosts.some((entry) => (entry.startsWith(".") ? host.endsWith(entry) : host === entry)),
  );
  const cloud = host ? candidates.find((provider) => provider.id === "cloud-postgres") : undefined;
  return (match ?? cloud ?? candidates[0]).id;
}

export function providerFor(connection: {
  kind: DatabaseKind;
  connectionString: string;
}): ProviderInfo {
  return (
    providerById(detectProvider(connection.connectionString, connection.kind)) ??
    providerForKind(connection.kind) ??
    FALLBACK_PROVIDERS[0]
  );
}

export function connectionSummary(value: string, kind = kindFromUrl(value)) {
  const resolved = kind ?? (isOracleKeyValue(value) ? "oracle" : undefined);
  const info = resolved ? providerForKind(resolved) : undefined;
  if (info?.file_based) {
    const path = filePath(value);
    return { host: path.split("/").pop() || path, port: "", database: path, user: "" };
  }
  if (resolved === "oracle" || resolved === undefined) {
    const oracle = parseOracleKeyValue(value);
    if (oracle) {
      try {
        const endpoint =
          parseOracleEndpoint(oracle.source) ?? endpointFromTnsDescriptor(oracle.source);
        if (endpoint?.service)
          return {
            host: endpoint.host,
            port: endpoint.port || "1521",
            database: endpoint.service,
            user: oracle.user,
          };
      } catch {
        return { host: oracle.source, port: "", database: oracle.source, user: oracle.user };
      }
      return { host: oracle.source, port: "", database: oracle.source, user: oracle.user };
    }
  }
  try {
    const url = new URL(value.trim());
    const override = resolved === "oracle" ? oracleConnectString(url) : null;
    if (override && !url.hostname) {
      const short = override.length > 48 ? "TNS-Verbindung" : override;
      return { host: short, port: "", database: override, user: decodeURIComponent(url.username) };
    }
    return {
      host: url.hostname,
      port: url.port || String(info?.default_port ?? ""),
      database: decodeURIComponent(url.pathname.slice(1)) || override || "",
      user: decodeURIComponent(url.username),
    };
  } catch {
    return { host: "Ungültiger Endpunkt", port: "", database: "", user: "" };
  }
}

const AUTH_ERROR_PATTERN =
  /password authentication|28P01|Access denied|Login failed|Authentication failed|NOAUTH|WRONGPASS|ORA-01017|ORA-01005/i;
export const AUTH_FAILED_MESSAGE =
  "Anmeldung fehlgeschlagen. Prüfe Benutzer und Datenbankpasswort.";

export function connectionError(error: unknown): string {
  const message = String(error)
    .replace(/(password|pwd)(\s*=\s*)("[^"]*"|'[^']*'|[^;\s]*)/gi, "$1$2***")
    .replace(/[a-z][a-z0-9+.-]*:\/\/[^\s]+/gi, "[Verbindungs-URL]");
  if (/__TAURI|invoke|undefined.*(properties|function)/i.test(message))
    return "Zum Testen und Verbinden öffne l8db als Desktop-App.";
  if (AUTH_ERROR_PATTERN.test(message)) return AUTH_FAILED_MESSAGE;
  if (
    /Oracle-Host \S+ (antwortet nicht|ist nicht erreichbar|kann nicht aufgelöst werden)/.test(
      message,
    )
  )
    return message.replace(/^Error:\s*/, "");
  if (/ORA-12514/i.test(message))
    return "Der Service-Name ist dem Listener unbekannt (ORA-12514). Prüfe Service-Name und Listener.";
  if (/ORA-12541/i.test(message))
    return "Kein Oracle-Listener auf Host und Port (ORA-12541). Prüfe Host, Port und ob die Datenbank läuft.";
  if (/ORA-12545/i.test(message))
    return "Der Ziel-Host existiert nicht (ORA-12545). Prüfe Hostnamen, DNS und VPN.";
  if (/certificate|tls|ssl/i.test(message))
    return "TLS-Verbindung fehlgeschlagen. Prüfe SSL-Modus, Servername und das Zertifikat im System-Zertifikatsspeicher.";
  if (/timeout|timed out/i.test(message))
    return "Der Server antwortet nicht rechtzeitig. Prüfe Endpunkt, Firewall und ob die Datenbank läuft.";
  if (/refused|resolve|dns|No such host/i.test(message))
    return "Der Server ist nicht erreichbar. Prüfe Host, Port und Netzwerkzugang.";
  return message.replace(/^Error:\s*/, "");
}
