import { connectionSummary } from "@/lib/connection-url";
import type { ConnectionEnvironment, SavedConnection } from "@/lib/connections";
import type { DatabaseKind } from "@/lib/db";

export type Groupable = Pick<SavedConnection, "connectionString" | "kind">;

export interface ServerGroup<T extends Groupable = SavedConnection> {
  key: string;
  label: string;
  kind: DatabaseKind;
  connections: T[];
  ruleId?: string;
}

export interface HostGroupRule {
  id: string;
  name: string;
  pattern: string;
  environment?: ConnectionEnvironment | null;
}

function hostPatternRegexes(pattern: string): RegExp[] {
  return pattern
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map(
      (part) =>
        new RegExp(
          `^${part
            .replace(/[.+^${}()|[\]\\]/g, "\\$&")
            .replace(/\*/g, ".*")
            .replace(/\?/g, ".")}$`,
          "i",
        ),
    );
}

export function matchingHostRule(
  connection: Pick<SavedConnection, "connectionString" | "kind">,
  rules: HostGroupRule[],
): HostGroupRule | undefined {
  const values = [
    serverLabel(connection),
    connectionSummary(connection.connectionString, connection.kind).host,
  ];
  return rules.find((rule) =>
    hostPatternRegexes(rule.pattern).some((regex) => values.some((value) => regex.test(value))),
  );
}

export function suggestHostPattern(connection: Pick<SavedConnection, "connectionString" | "kind">) {
  const host = connectionSummary(connection.connectionString, connection.kind).host;
  const prefix = (host.split(".")[0] ?? host).replace(/[\d_-]+$/, "");
  return `${prefix || host}*`;
}

export function groupKey(
  connection: Pick<SavedConnection, "connectionString" | "kind">,
  rules: HostGroupRule[],
) {
  const rule = matchingHostRule(connection, rules);
  return rule ? `rule|${rule.id}` : serverKey(connection);
}

export function sortServerGroups(
  groups: ServerGroup[],
  favoriteKeys: string[],
  order: string[],
): ServerGroup[] {
  const favorites = new Set(favoriteKeys);
  const positions = new Map(order.map((key, index) => [key, index]));
  return [...groups].sort((a, b) => {
    const favoriteDifference = Number(favorites.has(b.key)) - Number(favorites.has(a.key));
    if (favoriteDifference !== 0) return favoriteDifference;
    const positionA = positions.get(a.key) ?? Number.POSITIVE_INFINITY;
    const positionB = positions.get(b.key) ?? Number.POSITIVE_INFINITY;
    if (positionA !== positionB) return positionA - positionB;
    return a.label.localeCompare(b.label);
  });
}

export function connectionUser(connection: Pick<SavedConnection, "connectionString" | "kind">) {
  return connectionSummary(connection.connectionString, connection.kind).user;
}

export function matchesConnectionQuery(connection: SavedConnection, query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const endpoint = connectionSummary(connection.connectionString, connection.kind);
  return [
    connection.name,
    connection.kind,
    endpoint.host,
    endpoint.port,
    endpoint.user,
    endpoint.database,
    ...(connection.tags?.map((tag) => tag.name) ?? []),
    ...(connection.schemas ?? []),
  ]
    .join("\0")
    .toLowerCase()
    .includes(needle);
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

export function groupByServer<T extends Groupable = SavedConnection>(
  connections: T[],
  rules: HostGroupRule[] = [],
): ServerGroup<T>[] {
  const groups = new Map<string, ServerGroup<T>>();
  for (const connection of connections) {
    const rule = matchingHostRule(connection, rules);
    const key = rule ? `rule|${rule.id}` : serverKey(connection);
    const group = groups.get(key);
    if (group) group.connections.push(connection);
    else
      groups.set(key, {
        key,
        label: rule ? rule.name.trim() || rule.pattern : serverLabel(connection),
        kind: connection.kind,
        connections: [connection],
        ruleId: rule?.id,
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
