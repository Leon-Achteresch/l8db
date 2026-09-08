import { connectionSummary } from "@/lib/connection-url";
import type { SavedConnection } from "@/lib/connections";
import type { DatabaseKind } from "@/lib/db";

export interface ServerGroup {
  key: string;
  label: string;
  kind: DatabaseKind;
  connections: SavedConnection[];
}

export function connectionUser(connection: Pick<SavedConnection, "connectionString" | "kind">) {
  return connectionSummary(connection.connectionString, connection.kind).user;
}

export function serverLabel(connection: Pick<SavedConnection, "connectionString" | "kind">) {
  const endpoint = connectionSummary(connection.connectionString, connection.kind);
  const host = endpoint.port ? `${endpoint.host}:${endpoint.port}` : endpoint.host;
  return endpoint.database && endpoint.database !== endpoint.host
    ? `${host}/${endpoint.database}`
    : host;
}

export function serverKey(connection: Pick<SavedConnection, "connectionString" | "kind">) {
  return `${connection.kind}|${serverLabel(connection).toLowerCase()}`;
}

export function groupByServer(connections: SavedConnection[]): ServerGroup[] {
  const groups = new Map<string, ServerGroup>();
  for (const connection of connections) {
    const key = serverKey(connection);
    const group = groups.get(key);
    if (group) group.connections.push(connection);
    else
      groups.set(key, {
        key,
        label: serverLabel(connection),
        kind: connection.kind,
        connections: [connection],
      });
  }
  return [...groups.values()];
}

export function siblingConnections(
  connections: SavedConnection[],
  active: SavedConnection | null | undefined,
): SavedConnection[] {
  if (!active) return [];
  const key = serverKey(active);
  return connections.filter((entry) => entry.id !== active.id && serverKey(entry) === key);
}
