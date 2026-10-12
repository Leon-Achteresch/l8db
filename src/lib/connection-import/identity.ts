import type { NetworkProxy, SshConnection } from "@/lib/connections";
import type { DatabaseKind, EndpointIdentity } from "@/lib/db";

type SshIdentity = Pick<SshConnection, "host" | "port" | "user">;

function networkKey(ssh: SshIdentity | null | undefined, proxy: NetworkProxy | null | undefined) {
  const tunnel = ssh?.host ? `ssh:${ssh.host.toLowerCase()}:${ssh.port}:${ssh.user}` : "direct";
  const via = proxy?.host
    ? `proxy:${proxy.type}:${proxy.host.toLowerCase()}:${proxy.port}:${proxy.username ?? ""}`
    : "";
  return via ? `${tunnel}|${via}` : tunnel;
}

export function fileKey(path: string): string {
  return `file|${path.trim().replace(/^(sqlite|duckdb|file):(\/\/)?/i, "")}`;
}

export function identityKey(
  kind: DatabaseKind,
  identity: EndpointIdentity,
  ssh?: SshIdentity | null,
  proxy?: NetworkProxy | null,
): string {
  const params = [...identity.params]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join(",");
  return [
    kind,
    identity.transport,
    identity.host,
    identity.port ?? "",
    identity.database,
    identity.schema,
    identity.user,
    networkKey(ssh, proxy),
    params,
  ].join("|");
}
