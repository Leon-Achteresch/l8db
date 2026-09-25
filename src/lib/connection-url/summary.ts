import type { DatabaseKind, ProviderInfo } from "@/lib/db";
import { allProviders, FALLBACK_PROVIDERS, providerById, providerForKind } from "@/lib/providers";
import {
  endpointFromTnsDescriptor,
  oracleConnectString,
  oracleEndpointHost,
  parseOracleEndpoint,
} from "./oracle-endpoint";
import { isOracleKeyValue, parseOracleKeyValue } from "./oracle-key-value";
import { filePath, kindFromUrl } from "./parse";

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
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(value.trim())?.[1]?.toLowerCase();
  const byScheme = candidates.find((provider) => provider.id === scheme);
  return (match ?? cloud ?? byScheme ?? candidates[0]).id;
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
