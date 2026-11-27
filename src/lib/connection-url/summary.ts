import { fileName } from "@/lib/connection-import/paths";
import type { DatabaseKind, ProviderInfo } from "@/lib/db";
import { allProviders, FALLBACK_PROVIDERS, providerById, providerForKind } from "@/lib/providers";
import { serverProduct } from "@/lib/server-products";
import {
  endpointFromTnsDescriptor,
  oracleConnectString,
  oracleEndpointHost,
  parseOracleEndpoint,
} from "./oracle-endpoint";
import { isOracleKeyValue, parseOracleKeyValue } from "./oracle-key-value";
import { filePath, kindFromUrl, multiHostUrl } from "./parse";
import { isProfileConnection, parseProfileConnection } from "./profile-pointer";

function detectObjectStorage(value: string, candidates: ProviderInfo[]): string {
  let raw: string | null = null;
  try {
    raw = new URL(value.trim()).searchParams.get("endpoint");
  } catch {
    raw = null;
  }
  if (!raw) return "s3";
  let endpoint: URL;
  try {
    endpoint = new URL(raw);
  } catch {
    return "s3-compatible";
  }
  const host = endpoint.hostname.toLowerCase();
  if (host.endsWith(".amazonaws.com.cn")) return "s3";
  const match = candidates.find((provider) =>
    provider.hosts.some((entry) => (entry.startsWith(".") ? host.endsWith(entry) : host === entry)),
  );
  if (match) return match.id;
  const localMinio = endpoint.port === "9000" && (host === "localhost" || PRIVATE_IP.test(host));
  return host.includes("minio") || host.endsWith("min.io") || localMinio
    ? "minio"
    : "s3-compatible";
}

const PRIVATE_SUFFIX = /\.(intern|internal|local|localdomain|lan|corp|home|arpa)$/;
const PRIVATE_IP = /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/;

function publicHost(host: string): boolean {
  return (
    host.includes(".") &&
    !PRIVATE_SUFFIX.test(host) &&
    !PRIVATE_IP.test(host) &&
    !host.includes(":")
  );
}

export function detectProvider(value: string, kind = kindFromUrl(value)): string {
  const candidates = allProviders().filter((provider) => provider.kind === (kind ?? "postgres"));
  if (!candidates.length) return "postgres";
  if (candidates.length === 1 && candidates[0].file_based) return candidates[0].id;
  if (kind === "s3") return detectObjectStorage(value, candidates);
  if (kind === "odbc") {
    const raw = /(?:^|[;?&])\s*driver\s*=\s*\{?([^};&]+)/i.exec(value)?.[1] ?? "";
    let driver = raw.replace(/\+/g, " ");
    try {
      driver = decodeURIComponent(driver);
    } catch {}
    const byDriver = candidates.find(
      (provider) =>
        provider.driver.type === "odbc" &&
        provider.driver.driver !== "" &&
        provider.driver.driver.toLowerCase() === driver.trim().toLowerCase(),
    );
    if (byDriver) return byDriver.id;
  }
  let host = "";
  let port = "";
  const oracle = parseOracleKeyValue(value);
  if (oracle) {
    host = oracleEndpointHost(oracle.source).toLowerCase();
  } else {
    try {
      const url = new URL(value.trim());
      host = url.hostname.toLowerCase();
      port = url.port;
    } catch {
      host = "";
    }
  }
  const familyPort = candidates[0].default_port ?? 0;
  const samePort = candidates.filter(
    (provider) =>
      String(provider.default_port) === port && Math.abs(Number(port) - familyPort) > 10,
  );
  const match = candidates.find((provider) =>
    provider.hosts.some((entry) => (entry.startsWith(".") ? host.endsWith(entry) : host === entry)),
  );
  const cloud = publicHost(host)
    ? candidates.find((provider) => provider.id === "cloud-postgres")
    : undefined;
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(value.trim())?.[1]?.toLowerCase();
  const byScheme = candidates.find((provider) => provider.id === scheme);
  const byPort = samePort.length === 1 ? samePort[0] : undefined;
  const byDomain = match?.hosts.some((entry) => entry.startsWith(".") && host.endsWith(entry));
  return ((byDomain ? match : undefined) ?? byPort ?? match ?? cloud ?? byScheme ?? candidates[0])
    .id;
}

export function providerFor(connection: {
  kind: DatabaseKind;
  connectionString: string;
}): ProviderInfo {
  return (
    providerById(
      serverProduct(connection.connectionString) ??
        detectProvider(connection.connectionString, connection.kind),
    ) ??
    providerForKind(connection.kind) ??
    FALLBACK_PROVIDERS[0]
  );
}

export function connectionSummary(value: string, kind = kindFromUrl(value)) {
  const resolved = kind ?? (isOracleKeyValue(value) ? "oracle" : undefined);
  const info = resolved ? providerForKind(resolved) : undefined;
  if (resolved && isProfileConnection(resolved)) {
    try {
      const url = parseProfileConnection(value, resolved);
      return {
        host: resolved === "jdbc" ? "JDBC-Profil" : `Workspace ${url.hostname}`,
        port: "",
        database: resolved === "jdbc" ? url.pathname.slice("l8db:".length) : url.pathname.slice(1),
        user: "",
      };
    } catch {
      return { host: "Ungültiges Verbindungsprofil", port: "", database: "", user: "" };
    }
  }
  if (info?.file_based) {
    const path = filePath(value);
    return { host: fileName(path), port: "", database: path, user: "" };
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
    const multi = multiHostUrl(value);
    const url = new URL(multi ? multi.withHost(multi.hosts[0]) : value.trim());
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
