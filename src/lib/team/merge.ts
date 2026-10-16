import type { SavedConnection } from "@/lib/connections/types";

const isString = (value: unknown): value is string => typeof value === "string";
const isPort = (value: unknown) => Number.isInteger(value) && (value as number) > 0;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const oneOf = (values: string[]) => (value: unknown) => isString(value) && values.includes(value);
const isAuth = oneOf(["password", "key", "agent"]);
const isHop = (value: unknown) =>
  isRecord(value) &&
  isString(value.host) &&
  isPort(value.port) &&
  isString(value.user) &&
  isAuth(value.auth) &&
  isString(value.keyFile) &&
  (value.agentSocket === undefined || isString(value.agentSocket));

const TEAM_FIELDS = {
  name: isString,
  kind: isString,
  connectionString: isString,
  sslMode: oneOf(["disable", "prefer", "require", "verify-ca", "verify-full"]),
  ssh: (value: unknown) =>
    value === null ||
    (isHop(value) &&
      isRecord(value) &&
      isString(value.remoteHost) &&
      isPort(value.remotePort) &&
      (value.jumpHosts === undefined ||
        (Array.isArray(value.jumpHosts) && value.jumpHosts.every(isHop)))),
  proxy: (value: unknown) =>
    value === null ||
    (isRecord(value) &&
      oneOf(["socks5", "http"])(value.type) &&
      isString(value.host) &&
      isPort(value.port) &&
      (value.username === undefined || isString(value.username))),
  tags: (value: unknown) =>
    Array.isArray(value) &&
    value.every((tag) => isRecord(tag) && isString(tag.name) && isString(tag.color)),
  color: (value: unknown) => value === null || isString(value),
  readOnly: (value: unknown) => typeof value === "boolean",
  environment: (value: unknown) =>
    value === null || oneOf(["development", "test", "staging", "production"])(value),
  schemas: (value: unknown) => value === null || (Array.isArray(value) && value.every(isString)),
} satisfies Record<string, (value: unknown) => boolean>;

const FIELDS = Object.keys(TEAM_FIELDS) as (keyof typeof TEAM_FIELDS)[];

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const AUTHORITY = /^([a-z][a-z0-9+.-]*:\/\/)([^/?#]*)/i;

export interface TeamMerge {
  connections: SavedConnection[];
  removed: string[];
  added: number;
  updated: number;
}

export function teamConnectionId(hub: string, id: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < hub.length; index++)
    hash = Math.imul(hash ^ hub.charCodeAt(index), 0x01000193);
  return `team-${(hash >>> 0).toString(16)}-${id}`;
}

function pick(entry: unknown): Record<string, unknown> | null {
  if (!entry || typeof entry !== "object") return null;
  const source = entry as Record<string, unknown>;
  if (typeof source.id !== "string" || !SAFE_ID.test(source.id)) return null;
  for (const field of ["name", "kind", "connectionString"])
    if (typeof source[field] !== "string" || !source[field]) return null;
  const picked: Record<string, unknown> = { id: source.id };
  for (const field of FIELDS)
    if (source[field] !== undefined && TEAM_FIELDS[field](source[field]))
      picked[field] = source[field];
  return picked;
}

function same(left: unknown, right: unknown): boolean {
  return left === right || JSON.stringify(left) === JSON.stringify(right);
}

export function carryCredentials(next: string, previous: string): string {
  const target = next.match(AUTHORITY);
  const source = previous.match(AUTHORITY);
  if (!target || !source || target[2].includes("@")) return next;
  const at = source[2].lastIndexOf("@");
  if (at < 0) return next;
  return `${target[1]}${source[2].slice(0, at + 1)}${next.slice(target[0].length - target[2].length)}`;
}

export function mergeTeamConnections(
  local: SavedConnection[],
  hub: string,
  entries: unknown[],
): TeamMerge {
  const remote = new Map<string, Record<string, unknown>>();
  for (const entry of entries) {
    const picked = pick(entry);
    if (picked) remote.set(teamConnectionId(hub, picked.id as string), picked);
  }
  const removed: string[] = [];
  let updated = 0;
  const connections: SavedConnection[] = [];
  for (const connection of local) {
    const incoming = remote.get(connection.id);
    if (!incoming) {
      if (connection.team?.hub === hub) removed.push(connection.id);
      else connections.push(connection);
      continue;
    }
    remote.delete(connection.id);
    const base = connection.team?.hub === hub ? connection.team.base : {};
    const next: Record<string, unknown> = { ...connection };
    let changed = connection.team?.hub !== hub;
    for (const field of FIELDS) {
      if (same(incoming[field], base[field])) continue;
      changed = true;
      next[field] =
        field === "connectionString"
          ? carryCredentials(incoming[field] as string, connection.connectionString)
          : incoming[field];
    }
    if (!changed) {
      connections.push(connection);
      continue;
    }
    updated++;
    const { id, ...fields } = incoming;
    connections.push({
      ...(next as unknown as SavedConnection),
      team: { hub, id: id as string, base: fields },
    });
  }
  for (const [localId, incoming] of remote) {
    const { id, ...fields } = incoming;
    connections.push({
      ...(fields as unknown as Omit<SavedConnection, "id">),
      sslMode: (fields.sslMode as SavedConnection["sslMode"] | undefined) ?? "prefer",
      id: localId,
      team: { hub, id: id as string, base: fields },
    });
  }
  return { connections, removed, added: remote.size, updated };
}
