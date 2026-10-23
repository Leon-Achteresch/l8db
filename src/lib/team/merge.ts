import { SECRET_PARAM } from "@/lib/connection-export/types";
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
const USERINFO_PASSWORD = /:\/\/[^/@?#]*:[^/@?#]*@/;
const FORBIDDEN_PARAMS = new Set([
  "integratedsecurity",
  "trustedconnection",
  "privatekey",
  "privatekeyfile",
  "privatekeypath",
  "authenticator",
  "auth",
  "sslkey",
  "sslcert",
  "sslrootcert",
  "sslca",
  "sslcrl",
  "authmechanism",
  "l8dbauth",
  "l8dbaccesstoken",
  "clientcertificatekeystoreurl",
  "trustservercertificateca",
  "tlscertificatekeyfile",
  "tlscertificatefile",
  "tlscafile",
  "socket",
  "unixsocket",
  "socketpath",
  "enablecleartextplugin",
]);
function forbiddenParam(key: string): boolean {
  return FORBIDDEN_PARAMS.has(key.toLowerCase().replace(/[\s_-]/g, ""));
}

function parameters(value: string): [string, string][] {
  return value
    .split(/[?&;]/)
    .filter((part) => part.includes("="))
    .map((part) => {
      const index = part.indexOf("=");
      return [decodeURIComponentSafe(part.slice(0, index)).trim(), part.slice(index + 1).trim()];
    });
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export const TEAM_KINDS = [
  "postgres",
  "mysql",
  "mssql",
  "oracle",
  "clickhouse",
  "mongodb",
  "redis",
  "cassandra",
  "elasticsearch",
  "influxdb",
  "snowflake",
];
const AUTHORITY = /^([a-z][a-z0-9+.-]*:\/\/)([^/?#]*)/i;

export interface TeamMerge {
  connections: SavedConnection[];
  removed: string[];
  retargeted: string[];
  warnings: string[];
  added: number;
  updated: number;
}

export function teamConnectionId(hub: string, id: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < hub.length; index++)
    hash = Math.imul(hash ^ hub.charCodeAt(index), 0x01000193);
  return `team-${(hash >>> 0).toString(16)}-${id}`;
}

function pick(entry: unknown): Record<string, unknown> | string {
  if (!entry || typeof entry !== "object") return "Ungültiger Eintrag übersprungen";
  const source = entry as Record<string, unknown>;
  const label = `„${typeof source.name === "string" ? source.name : String(source.id)}“`;
  if (typeof source.id !== "string" || !SAFE_ID.test(source.id))
    return `${label}: ungültige id, übersprungen`;
  for (const field of ["name", "kind", "connectionString"])
    if (typeof source[field] !== "string" || !source[field])
      return `${label}: ${field} fehlt, übersprungen`;
  if (!TEAM_KINDS.includes(source.kind as string))
    return `${label}: Typ „${String(source.kind)}“ ist für Team-Verbindungen nicht erlaubt, übersprungen`;
  const connectionString = source.connectionString as string;
  if (
    [...connectionString].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ||
    (connectionString.includes("://") && connectionString.includes("\\"))
  )
    return `${label}: Adresse enthält Steuerzeichen oder einen Backslash, übersprungen`;
  const authority = connectionString.match(AUTHORITY);
  if (authority && connectionString.slice(authority[0].length).includes("@"))
    return `${label}: Adresse enthält ein @ nach dem Host, übersprungen`;
  const keys = parameters(connectionString).map(([key]) => key);
  if (USERINFO_PASSWORD.test(connectionString) || keys.some((key) => SECRET_PARAM.test(key)))
    return `${label}: enthält ein Passwort oder Token, übersprungen`;
  const forbidden = keys.find(forbiddenParam);
  if (forbidden)
    return `${label}: Parameter „${forbidden}“ ist für Team-Verbindungen nicht erlaubt, übersprungen`;
  const picked: Record<string, unknown> = { id: source.id };
  for (const field of FIELDS)
    if (source[field] !== undefined && TEAM_FIELDS[field](source[field]))
      picked[field] = source[field];
  if (isRecord(picked.ssh)) {
    const local = (hop: Record<string, unknown>) => {
      const { agentSocket: _socket, ...rest } = hop;
      return { ...rest, keyFile: "" };
    };
    const ssh = picked.ssh as Record<string, unknown> & { jumpHosts?: Record<string, unknown>[] };
    picked.ssh = {
      ...local(ssh),
      ...(ssh.jumpHosts ? { jumpHosts: ssh.jumpHosts.map(local) } : {}),
    };
  }
  return picked;
}

export function withoutPassword(value: string): string {
  return value
    .replace(/^([a-z][a-z0-9+.-]*:\/\/[^/?#@:]*):[^/?#@]*@/i, "$1@")
    .replace(/(^|;)\s*(password|pwd)\s*=[^;]*/gi, "");
}

type Hop = { host?: unknown; port?: unknown; keyFile?: unknown; agentSocket?: unknown };

function sshTarget(ssh: unknown): unknown {
  if (!isRecord(ssh)) return null;
  const hops = Array.isArray(ssh.jumpHosts) ? (ssh.jumpHosts as Hop[]) : [];
  return [
    ssh.host,
    ssh.port,
    ssh.remoteHost,
    ssh.remotePort,
    hops.map((hop) => [hop.host, hop.port]),
  ];
}

function withLocalKeys(incoming: unknown, local: unknown): unknown {
  if (!isRecord(incoming)) return incoming;
  const own = isRecord(local) ? (local as Hop & { jumpHosts?: Hop[] }) : {};
  const keep = (hop: Hop, mine: Hop | undefined) => ({
    ...hop,
    keyFile: typeof mine?.keyFile === "string" ? mine.keyFile : "",
    ...(typeof mine?.agentSocket === "string" ? { agentSocket: mine.agentSocket } : {}),
  });
  const hops = Array.isArray(incoming.jumpHosts) ? (incoming.jumpHosts as Hop[]) : null;
  return {
    ...keep(incoming as Hop, own),
    ...(hops
      ? {
          jumpHosts: hops.map((hop) =>
            keep(
              hop,
              own.jumpHosts?.find((mine) => mine.host === hop.host),
            ),
          ),
        }
      : {}),
  };
}

function target(fields: Record<string, unknown>): string {
  const value = typeof fields.connectionString === "string" ? fields.connectionString : "";
  const match = value.match(AUTHORITY);
  const endpoint = match
    ? `${match[1]}${match[2].slice(match[2].lastIndexOf("@") + 1)}${value.slice(match[0].length)}`
    : value;
  return JSON.stringify([
    fields.kind ?? null,
    endpoint,
    fields.sslMode ?? null,
    sshTarget(fields.ssh),
    fields.proxy ?? null,
  ]);
}

function same(left: unknown, right: unknown): boolean {
  return left === right || JSON.stringify(left) === JSON.stringify(right);
}

export function carryCredentials(next: string, previous: string, withPassword = true): string {
  const destination = next.match(AUTHORITY);
  const source = previous.match(AUTHORITY);
  if (!destination || !source || destination[2].includes("@")) return next;
  const at = source[2].lastIndexOf("@");
  if (at < 0) return next;
  const userinfo = source[2].slice(0, at);
  const kept = withPassword ? userinfo : userinfo.split(":")[0];
  return `${destination[1]}${kept}@${next.slice(destination[0].length - destination[2].length)}`;
}

export function mergeTeamConnections(
  local: SavedConnection[],
  hub: string,
  entries: unknown[],
): TeamMerge {
  const remote = new Map<string, Record<string, unknown>>();
  const warnings: string[] = [];
  for (const entry of entries) {
    const picked = pick(entry);
    if (typeof picked === "string") warnings.push(picked);
    else remote.set(teamConnectionId(hub, picked.id as string), picked);
  }
  const removed: string[] = [];
  const retargeted: string[] = [];
  let updated = 0;
  const connections: SavedConnection[] = [];
  for (const connection of local) {
    const key = remote.has(connection.id)
      ? connection.id
      : connection.team?.hub === hub
        ? teamConnectionId(hub, connection.team.id)
        : connection.id;
    const incoming = remote.get(key);
    if (!incoming) {
      if (connection.team?.hub === hub) removed.push(connection.id);
      else connections.push(connection);
      continue;
    }
    remote.delete(key);
    const base = connection.team?.hub === hub ? connection.team.base : {};
    const next: Record<string, unknown> = { ...connection };
    let changed = connection.team?.hub !== hub;
    for (const field of FIELDS) {
      if (same(incoming[field], base[field])) continue;
      changed = true;
      next[field] = field === "ssh" ? withLocalKeys(incoming.ssh, connection.ssh) : incoming[field];
    }
    if (changed) {
      const moved = target(incoming) !== target(base);
      if (moved) retargeted.push(connection.id);
      next.connectionString = same(incoming.connectionString, base.connectionString)
        ? moved
          ? withoutPassword(connection.connectionString)
          : connection.connectionString
        : carryCredentials(
            incoming.connectionString as string,
            connection.connectionString,
            !moved,
          );
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
  return { connections, removed, retargeted, warnings, added: remote.size, updated };
}
