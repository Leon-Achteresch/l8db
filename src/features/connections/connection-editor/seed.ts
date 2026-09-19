import {
  connectionSummary,
  filePath,
  isTrustedConnection,
  oracleConnectString,
  parseConnectionUrl,
} from "@/lib/connection-url";
import type { SavedConnection } from "@/lib/connections";
import type { ProviderInfo } from "@/lib/db";
import { extractUrlPassword } from "@/lib/secrets";
import type { Mode } from "./types";

export function placeholderDefaults(info: ProviderInfo) {
  try {
    const url = new URL(info.placeholder);
    return {
      host: url.hostname || "localhost",
      port: url.port || String(info.default_port ?? ""),
      database: decodeURIComponent(url.pathname.slice(1)),
      user: decodeURIComponent(url.username),
    };
  } catch {
    return { host: "localhost", port: String(info.default_port ?? ""), database: "", user: "" };
  }
}

export function seedFields(
  seed: SavedConnection | undefined,
  info: ProviderInfo,
  clearUser: boolean,
) {
  const defaults = placeholderDefaults(info);
  if (!seed) {
    return {
      ...defaults,
      password: "",
      file: "",
      extraParams: "",
      trusted: false,
      tnsAlias: "",
    };
  }
  if (info.file_based) {
    return {
      ...defaults,
      password: "",
      file: filePath(seed.connectionString),
      extraParams: "",
      trusted: false,
      tnsAlias: "",
    };
  }
  try {
    const url = parseConnectionUrl(seed.connectionString, seed.kind);
    return {
      host: url.hostname || defaults.host,
      port: url.port || defaults.port,
      database: decodeURIComponent(url.pathname.slice(1)),
      user: clearUser ? "" : decodeURIComponent(url.username),
      password: clearUser ? "" : decodeURIComponent(url.password),
      file: "",
      extraParams: url.search,
      trusted: isTrustedConnection(url),
      tnsAlias: seed.kind === "oracle" ? (oracleConnectString(url) ?? "") : "",
    };
  } catch {
    const summary = connectionSummary(seed.connectionString, seed.kind);
    return {
      host: summary.host || defaults.host,
      port: summary.port || defaults.port,
      database: summary.database || defaults.database,
      user: clearUser ? "" : summary.user,
      password: clearUser ? "" : (extractUrlPassword(seed.connectionString) ?? ""),
      file: "",
      extraParams: "",
      trusted: false,
      tnsAlias: "",
    };
  }
}

export function seedMode(seed: SavedConnection | undefined, info: ProviderInfo): Mode {
  if (!seed || info.file_based) return "fields";
  try {
    const url = parseConnectionUrl(seed.connectionString, seed.kind);
    if (seed.kind === "oracle" && oracleConnectString(url)) return "tns";
  } catch {
    return "fields";
  }
  return "fields";
}
