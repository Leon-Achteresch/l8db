import { stripConnectionSecrets } from "@/lib/connection-export";
import type { SavedConnection } from "@/lib/connections";
import type { DatabaseKind, ProviderInfo } from "@/lib/db";
import { DRIVER_FAMILY_TITLES, driverTypeLabel } from "@/lib/drivers";
import type { SettingsState } from "@/lib/settings";
import type { DiagnosticsConnection, DiagnosticsDriver, DiagnosticsProvider } from "./types";

const SAFE_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0", "host.docker.internal"]);

export function maskHost(host: string): string {
  const value = host.trim();
  if (!value) return "";
  if (SAFE_HOSTS.has(value.toLowerCase())) return value;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) {
    return `${value.split(".")[0]}.x.x.x`;
  }
  if (value.includes(":")) return "ip6-masked";
  const labels = value.split(".");
  if (labels.length === 1) return `${labels[0]?.slice(0, 1) ?? ""}***`;
  const last = labels[labels.length - 1] ?? "";
  const masked = labels
    .slice(0, -1)
    .map((label) => `${label.slice(0, 1)}***`)
    .join(".");
  return `${masked}.${last}`;
}

const SECRET_TEXT =
  /(password|passwd|pwd|token|secret|api[_-]?key|apikey|authorization|bearer|passphrase)\s*[:=]\s*\S+/gi;

export function redactErrorMessage(message: string): string {
  return message
    .replace(/[a-z][a-z0-9+.-]*:\/\/[^\s"']+/gi, (url) => {
      const parsed = splitConnectionString(stripConnectionSecrets(url));
      return parsed.host ? `${parsed.scheme}://${maskHost(parsed.host)}` : "<url>";
    })
    .replace(SECRET_TEXT, (match) => `${match.split(/[:=]/)[0]}=<redacted>`)
    .slice(0, 500);
}

interface SplitConnection {
  scheme: string;
  host: string;
  port: number | null;
}

function splitConnectionString(value: string): SplitConnection {
  const schemeMatch = /^([a-z][a-z0-9+.-]*):\/\//i.exec(value);
  if (!schemeMatch) {
    const hostEntry = /(?:^|;)\s*(?:server|host|data source)\s*=\s*([^;]+)/i.exec(value);
    const portEntry = /(?:^|;)\s*port\s*=\s*(\d+)/i.exec(value);
    const raw = (hostEntry?.[1] ?? "").trim();
    const [host, inlinePort] = raw.split(",");
    const port = Number(portEntry?.[1] ?? inlinePort ?? "");
    return {
      scheme: "",
      host: host ?? "",
      port: Number.isFinite(port) && port > 0 ? port : null,
    };
  }
  const scheme = schemeMatch[1] ?? "";
  const rest = value.slice(schemeMatch[0].length);
  const authority = rest.split(/[/?#]/)[0] ?? "";
  const hostPart = authority.includes("@")
    ? authority.slice(authority.lastIndexOf("@") + 1)
    : authority;
  const firstHost = hostPart.split(",")[0] ?? "";
  const portMatch = /:(\d+)$/.exec(firstHost);
  const host = portMatch ? firstHost.slice(0, firstHost.length - portMatch[0].length) : firstHost;
  const port = portMatch ? Number(portMatch[1]) : null;
  return { scheme, host, port: port && Number.isFinite(port) ? port : null };
}

export function redactConnection(connection: SavedConnection): DiagnosticsConnection {
  const stripped = stripConnectionSecrets(connection.connectionString ?? "");
  const parts = splitConnectionString(stripped);
  return {
    name: connection.name,
    kind: connection.kind,
    scheme: parts.scheme,
    host: maskHost(parts.host),
    port: parts.port,
    sslMode: connection.sslMode,
    usesSsh: Boolean(connection.ssh?.host),
    tagCount: connection.tags?.length ?? 0,
  };
}

export function redactSettings(settings: SettingsState): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(settings)) {
    if (typeof value === "function") continue;
    result[key] = value;
  }
  return result;
}

export function providerDiagnostics(providers: ProviderInfo[]): DiagnosticsProvider[] {
  return providers.map((provider) => ({
    id: provider.id,
    name: provider.name,
    kind: provider.kind,
    group: provider.group,
    driverAvailable: provider.driver_status.available,
  }));
}

export function driverDiagnostics(providers: ProviderInfo[]): DiagnosticsDriver[] {
  const seen = new Map<DatabaseKind, DiagnosticsDriver>();
  for (const provider of providers) {
    if (seen.has(provider.kind)) continue;
    seen.set(provider.kind, {
      kind: provider.kind,
      title: DRIVER_FAMILY_TITLES[provider.kind] ?? provider.kind,
      type: driverTypeLabel(provider.driver),
      available: provider.driver_status.available,
      detail: provider.driver_status.detail,
    });
  }
  return [...seen.values()];
}
