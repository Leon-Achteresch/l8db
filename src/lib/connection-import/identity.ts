import type { NetworkProxy, SshConnection } from "@/lib/connections";
import type { DatabaseKind } from "@/lib/db";
import { ADAPTERS, SCHEME_ALIASES } from "./adapters";
import { FILE_KINDS } from "./products";
import { implicitPort } from "./transport";

type SshIdentity = Pick<SshConnection, "host" | "port" | "user">;

const TRUE_VALUES = ["1", "true", "yes", "on"];

function networkKey(ssh: SshIdentity | null | undefined, proxy: NetworkProxy | null | undefined) {
  const tunnel = ssh?.host ? `ssh:${ssh.host.toLowerCase()}:${ssh.port}:${ssh.user}` : "direct";
  const via = proxy?.host
    ? `proxy:${proxy.type}:${proxy.host.toLowerCase()}:${proxy.port}:${proxy.username ?? ""}`
    : "";
  return via ? `${tunnel}|${via}` : tunnel;
}

function searchParam(url: URL, name: string): string {
  const lower = name.toLowerCase();
  for (const [key, value] of url.searchParams) if (key.toLowerCase() === lower) return value;
  return "";
}

function urlTls(url: URL, scheme: string): boolean {
  if (scheme === "rediss") return true;
  if (
    ["secure", "ssl", "tls"].some((key) =>
      TRUE_VALUES.includes(searchParam(url, key).toLowerCase()),
    )
  )
    return true;
  return ["require", "verify-ca", "verify-full"].includes(
    searchParam(url, "sslmode").toLowerCase(),
  );
}

export function endpointKey(
  kind: DatabaseKind,
  connectionString: string,
  ssh?: SshIdentity | null,
  proxy?: NetworkProxy | null,
): string | null {
  const value = connectionString.trim();
  if (!value) return null;
  if (FILE_KINDS.includes(kind))
    return `file|${value.replace(/^(sqlite|duckdb|file):(\/\/)?/i, "")}`;
  if (!value.includes("://")) return null;
  try {
    const url = new URL(value);
    const raw = url.protocol.slice(0, -1).toLowerCase();
    const scheme = SCHEME_ALIASES[raw] ?? raw;
    const port = url.port || String(implicitPort(kind, urlTls(url, raw)) ?? "");
    const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
    const identity = (ADAPTERS[kind]?.identity ?? [])
      .map((name) => `${name}=${searchParam(url, name)}`)
      .join(",");
    return [
      scheme,
      url.hostname.replace(/^\[|\]$/g, "").toLowerCase(),
      port,
      database,
      decodeURIComponent(url.username),
      networkKey(ssh, proxy),
      identity,
    ].join("|");
  } catch {
    return null;
  }
}
