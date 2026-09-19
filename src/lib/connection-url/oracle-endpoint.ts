import { type OracleEndpoint, parseOracleKeyValue } from "./oracle-key-value";
import { parseConnectionUrl } from "./parse";

function checkOraclePort(port: string): void {
  const num = Number(port);
  if (!/^\d+$/.test(port) || !Number.isInteger(num) || num < 1 || num > 65535)
    throw new Error("Der Port muss zwischen 1 und 65535 liegen.");
}

export function parseOracleEndpoint(source: string): OracleEndpoint | null {
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

export function endpointFromTnsDescriptor(source: string): OracleEndpoint | null {
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

export function oracleEndpointHost(source: string): string {
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
