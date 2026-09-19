import { isReadOnlyConnection, type SavedConnection, useConnectionsStore } from "@/lib/connections";
import { type DatabaseKind, registerReadOnlyResolver } from "@/lib/db";
import { capabilitiesFor } from "@/lib/providers";
import { extractUrlPassword, injectUrlPassword, peekSecret } from "@/lib/secrets";

export function sshSecretAccount(connectionId: string): string {
  return `${connectionId}:ssh`;
}

export function rewriteHostPort(url: string, host: string, port: number): string {
  const scheme = url.indexOf("://");
  if (scheme < 0) return url;
  const prefix = url.slice(0, scheme + 3);
  const rest = url.slice(scheme + 3);
  const authEnd = rest.search(/[/?#]/);
  const end = authEnd < 0 ? rest.length : authEnd;
  const authority = rest.slice(0, end);
  const tail = rest.slice(end);
  const at = authority.lastIndexOf("@");
  const userinfo = at < 0 ? "" : `${authority.slice(0, at)}@`;
  return `${prefix}${userinfo}${host}:${port}${tail}`;
}

export function tunneledConnectionString(
  value: string,
  port: number,
  kind: DatabaseKind = "postgres",
): string {
  if (kind !== "postgres") return rewriteHostPort(value, "127.0.0.1", port);
  const url = new URL(value);
  url.port = String(port);
  const params = url.search
    .slice(1)
    .split("&")
    .filter(
      (part) => part && !["hostaddr", "port"].includes(decodeURIComponent(part.split("=")[0])),
    );
  params.push("hostaddr=127.0.0.1");
  url.search = params.join("&");
  return url.toString();
}

export const READ_ONLY_OPTION = "-c default_transaction_read_only=on";

export function readOnlyConnectionString(value: string): string {
  const url = new URL(value);
  const params = url.search
    .slice(1)
    .split("&")
    .filter((part) => part && decodeURIComponent(part.split("=")[0]) !== "options");
  params.push(`options=${encodeURIComponent(READ_ONLY_OPTION)}`);
  url.search = params.join("&");
  return url.toString();
}

export function proxyUserConnectionString(
  value: string,
  connection: Pick<SavedConnection, "kind" | "proxyUser">,
): string {
  const user = connection.proxyUser?.trim();
  if (!user && !value.includes("proxy_user=")) return value;
  if (!capabilitiesFor(connection.kind).proxy_user) return value;
  const query = value.indexOf("?");
  const params = (query < 0 ? "" : value.slice(query + 1))
    .split("&")
    .filter((part) => part && decodeURIComponent(part.split("=")[0]) !== "proxy_user");
  if (user) params.push(`proxy_user=${encodeURIComponent(user)}`);
  const base = query < 0 ? value : value.slice(0, query);
  return params.length ? `${base}?${params.join("&")}` : base;
}

registerReadOnlyResolver((connectionString) => {
  const { connections, activeId } = useConnectionsStore.getState();
  if (typeof connectionString === "string") {
    const matches = connections.filter((entry) => {
      try {
        return effectiveConnectionString(entry) === connectionString;
      } catch {
        return false;
      }
    });
    if (matches.length) return matches.some(isReadOnlyConnection);
  }
  return isReadOnlyConnection(connections.find((entry) => entry.id === activeId));
});

export function effectiveConnectionString(connection: SavedConnection): string {
  const cached = peekSecret(connection.id);
  const raw =
    cached && extractUrlPassword(connection.connectionString) === null
      ? injectUrlPassword(connection.connectionString, cached)
      : connection.connectionString;
  const base = proxyUserConnectionString(
    isReadOnlyConnection(connection) ? readOnlyConnectionString(raw) : raw,
    connection,
  );
  if (!connection.ssh?.host) return base;
  if (!connection.tunnelPort)
    throw new Error("SSH-Tunnel ist nicht verbunden. Bitte erneut verbinden.");
  return tunneledConnectionString(base, connection.tunnelPort, connection.kind);
}
