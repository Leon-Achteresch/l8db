import type { NetworkProxy, SshConnection } from "@/lib/connections";
import type { DatabaseKind } from "@/lib/db";
import { ADAPTERS } from "./adapters";
import { FILE_KINDS } from "./products";
import { adapterTls, implicitPort } from "./transport";

type SshIdentity = Pick<SshConnection, "host" | "port" | "user">;

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

export function effectiveTls(kind: DatabaseKind, url: URL): boolean {
  const facts = ADAPTERS[kind];
  if (!facts) return false;
  return (
    adapterTls(facts, facts.flagKeys, {
      scheme: url.protocol.slice(0, -1),
      port: url.port ? Number(url.port) : null,
      params: [...url.searchParams],
    }) ?? false
  );
}

function aliasValue(url: URL, group: string): string {
  for (const alias of group.split("|")) {
    const value = searchParam(url, alias);
    if (value) return value;
  }
  return "";
}

function identityValue(url: URL, group: string): string {
  return `${group.split("|")[0]}=${aliasValue(url, group)}`;
}

function pathKey(url: URL, pathParams: string[] | undefined): string {
  const path = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!pathParams) return path;
  const segments = path.split("/");
  return pathParams
    .map((group, index) => aliasValue(url, group) || segments[index] || "")
    .join("/");
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
    const scheme = url.protocol.slice(0, -1).toLowerCase();
    const facts = ADAPTERS[kind];
    const tls = effectiveTls(kind, url);
    const srv = scheme === "mongodb+srv";
    const family = [kind, srv ? "srv" : "", facts?.tlsInKey && tls ? "tls" : ""]
      .filter(Boolean)
      .join("+");
    const port = srv ? "" : url.port || String(implicitPort(kind, tls) ?? "");
    const identity = (facts?.identity ?? []).map((group) => identityValue(url, group)).join(",");
    return [
      family,
      url.hostname.replace(/^\[|\]$/g, "").toLowerCase(),
      port,
      pathKey(url, facts?.pathParams),
      decodeURIComponent(url.username),
      networkKey(ssh, proxy),
      identity,
    ].join("|");
  } catch {
    return null;
  }
}
