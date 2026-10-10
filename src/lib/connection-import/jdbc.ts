export interface JdbcTarget {
  subprotocol: string;
  host: string;
  port: number | null;
  database: string;
  user: string;
  password: string;
  params: Array<[string, string]>;
  path: string;
  oracleSid: boolean;
  oracleDescriptor: string;
  srv: boolean;
}

const USER_KEYS = new Set(["user", "username", "user-name", "uid", "userid"]);

const PASSWORD_KEYS = new Set(["password", "pwd", "pass"]);

const DATABASE_KEYS = new Set(["databasename", "database", "dbname", "initialcatalog"]);

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function parsePort(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const port = Number(String(value).trim());
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
}

function emptyTarget(subprotocol: string): JdbcTarget {
  return {
    subprotocol,
    host: "",
    port: null,
    database: "",
    user: "",
    password: "",
    params: [],
    path: "",
    oracleSid: false,
    oracleDescriptor: "",
    srv: false,
  };
}

function absorbParam(target: JdbcTarget, key: string, value: string) {
  const lower = key.trim().toLowerCase();
  if (!lower) return;
  if (USER_KEYS.has(lower)) {
    if (!target.user) target.user = value;
    return;
  }
  if (PASSWORD_KEYS.has(lower)) {
    if (!target.password) target.password = value;
    return;
  }
  if (DATABASE_KEYS.has(lower)) {
    if (!target.database) target.database = value;
    return;
  }
  target.params.push([key.trim(), value]);
}

function splitHostPort(authority: string): { host: string; port: number | null } {
  const first = authority.split(",")[0]?.trim() ?? "";
  if (first.startsWith("[")) {
    const end = first.indexOf("]");
    if (end < 0) return { host: "", port: null };
    const rest = first.slice(end + 1);
    return {
      host: first.slice(1, end),
      port: rest.startsWith(":") ? parsePort(rest.slice(1)) : null,
    };
  }
  const colon = first.lastIndexOf(":");
  if (colon > 0 && first.indexOf(":") === colon)
    return { host: first.slice(0, colon), port: parsePort(first.slice(colon + 1)) };
  return { host: first, port: null };
}

function parseSqlServer(rest: string, target: JdbcTarget): JdbcTarget {
  const [address = "", ...parts] = rest.split(";");
  const slash = address.indexOf("/");
  const hostPart = slash < 0 ? address : address.slice(0, slash);
  if (slash >= 0 && address.slice(slash + 1)) target.database = decode(address.slice(slash + 1));
  const { host, port } = splitHostPort(hostPart);
  const instance = host.indexOf("\\");
  target.host = instance < 0 ? host : host.slice(0, instance);
  if (instance >= 0) target.params.push(["instanceName", host.slice(instance + 1)]);
  target.port = port;
  for (const part of parts) {
    const equals = part.indexOf("=");
    if (equals < 0) continue;
    const key = part.slice(0, equals);
    const value = part.slice(equals + 1);
    if (/^(servername|server)$/i.test(key.trim()) && !target.host) target.host = value;
    else if (/^portnumber$/i.test(key.trim()) && !target.port) target.port = parsePort(value);
    else if (/^instancename$/i.test(key.trim())) target.params.push(["instanceName", value]);
    else absorbParam(target, key, value);
  }
  return target;
}

function parseOracle(rest: string, target: JdbcTarget): JdbcTarget {
  let source = rest.replace(/^(thin|oci8?|kprb):/i, "");
  const at = source.lastIndexOf("@");
  if (at > 0) {
    const credentials = source.slice(0, at);
    const separator = credentials.search(/[/:]/);
    target.user = decode(separator < 0 ? credentials : credentials.slice(0, separator));
    if (separator >= 0) target.password = decode(credentials.slice(separator + 1));
  }
  source = at >= 0 ? source.slice(at + 1) : source;
  const question = source.indexOf("?");
  if (question >= 0) {
    for (const pair of source.slice(question + 1).split("&")) {
      const equals = pair.indexOf("=");
      if (equals > 0)
        absorbParam(target, decode(pair.slice(0, equals)), decode(pair.slice(equals + 1)));
    }
    source = source.slice(0, question);
  }
  source = source.trim();
  if (source.startsWith("(")) {
    target.oracleDescriptor = source;
    target.host = /\(\s*host\s*=\s*([^)\s]+)\s*\)/i.exec(source)?.[1] ?? "tns";
    target.port = parsePort(/\(\s*port\s*=\s*(\d+)\s*\)/i.exec(source)?.[1]);
    const service = /\(\s*service_name\s*=\s*([^)\s]+)\s*\)/i.exec(source)?.[1];
    const sid = /\(\s*sid\s*=\s*([^)\s]+)\s*\)/i.exec(source)?.[1];
    target.database = service ?? sid ?? "";
    target.oracleSid = !service && Boolean(sid);
    return target;
  }
  source = source.replace(/^\/\//, "");
  const serviceMatch = /^(\[[^\]]+\]|[^:/]+)(?::(\d+))?\/(.+)$/.exec(source);
  if (serviceMatch) {
    target.host = serviceMatch[1].replace(/^\[|\]$/g, "");
    target.port = parsePort(serviceMatch[2]);
    target.database = serviceMatch[3].split(":")[0] ?? "";
    return target;
  }
  const sidMatch = /^(\[[^\]]+\]|[^:/]+):(\d+):(.+)$/.exec(source);
  if (sidMatch) {
    target.host = sidMatch[1].replace(/^\[|\]$/g, "");
    target.port = parsePort(sidMatch[2]);
    target.database = sidMatch[3];
    target.oracleSid = true;
    return target;
  }
  if (/^[A-Za-z0-9._-]+$/.test(source)) {
    target.oracleDescriptor = source;
    target.host = source;
  }
  return target;
}

function parseAuthorityUrl(rest: string, target: JdbcTarget): JdbcTarget | null {
  const schemeEnd = rest.indexOf("//");
  if (schemeEnd < 0) return null;
  let remainder = rest.slice(schemeEnd + 2);
  const semicolon = remainder.indexOf(";");
  const question = remainder.indexOf("?");
  const queryStart =
    question >= 0 && (semicolon < 0 || question < semicolon) ? question : semicolon;
  let query = "";
  if (queryStart >= 0) {
    query = remainder.slice(queryStart + 1);
    remainder = remainder.slice(0, queryStart);
  }
  const slash = remainder.indexOf("/");
  let authority = slash < 0 ? remainder : remainder.slice(0, slash);
  const path = slash < 0 ? "" : remainder.slice(slash + 1);
  const at = authority.lastIndexOf("@");
  if (at >= 0) {
    const credentials = authority.slice(0, at);
    authority = authority.slice(at + 1);
    const colon = credentials.indexOf(":");
    target.user = decode(colon < 0 ? credentials : credentials.slice(0, colon));
    if (colon >= 0) target.password = decode(credentials.slice(colon + 1));
  }
  const { host, port } = splitHostPort(authority);
  target.host = decode(host);
  target.port = port;
  target.database = decode(path.split("/")[0] ?? "");
  for (const pair of query.split(/[&;]/)) {
    const equals = pair.indexOf("=");
    if (equals > 0)
      absorbParam(target, decode(pair.slice(0, equals)), decode(pair.slice(equals + 1)));
  }
  return target;
}

export function expandHomeMacro(path: string): string {
  return path.replace(/^\$USER_HOME\$/, "~");
}

export function parseJdbcUrl(url: string): JdbcTarget | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  const withoutPrefix = trimmed.replace(/^jdbc:/i, "");
  const subprotocolMatch = /^([a-z][a-z0-9+.-]*)(?::|$)/i.exec(withoutPrefix);
  if (!subprotocolMatch) return null;
  const subprotocol = subprotocolMatch[1].toLowerCase();
  const rest = withoutPrefix.slice(subprotocolMatch[0].length);
  const target = emptyTarget(subprotocol);
  if (subprotocol === "sqlserver") return parseSqlServer(rest.replace(/^\/\//, ""), target);
  if (subprotocol === "jtds") {
    const inner = rest.replace(/^(sqlserver|sybase):/i, "");
    return parseSqlServer(inner.replace(/^\/\//, ""), target);
  }
  if (subprotocol === "oracle") return parseOracle(rest, target);
  if (subprotocol === "sqlite" || subprotocol === "duckdb") {
    const path = rest.replace(/^\/\/(?=\/)/, "").split("?")[0] ?? "";
    target.path = expandHomeMacro(decode(path));
    return target;
  }
  if (subprotocol === "mongodb+srv") target.srv = true;
  if (subprotocol === "postgresql" && !rest.startsWith("//")) {
    target.host = "localhost";
    target.database = rest.split("?")[0] ?? "";
    return target;
  }
  const inner = rest.replace(/^(loadbalance|replication|aurora|http|https|ch):/i, "");
  return parseAuthorityUrl(inner, target);
}
