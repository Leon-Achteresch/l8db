import { useConnectionsStore } from "@/lib/connections";
import { persistedConnectionString } from "@/lib/connections/store";
import type { SavedConnection } from "@/lib/connections/types";
import { teamShare } from "@/lib/db/team";
import { mergeTeamConnections, withoutPassword } from "./merge";
import { useTeamStore } from "./store";
import { MICROSOFT_HUB } from "./sync";

const OPTIONAL = [
  "sslMode",
  "tags",
  "color",
  "readOnly",
  "environment",
  "schemas",
  "proxy",
] as const;

const USER_KEY = /^\s*(user id|uid|user|username|login)\s*$/i;

export function withoutUser(value: string): string {
  const stripped = withoutPassword(value)
    .replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/?#@]*@/i, "$1")
    .replace(/(^|;)\s*(user id|uid|user|username)\s*=[^;]*/gi, "");
  const query = stripped.indexOf("?");
  if (query < 0 || !stripped.includes("://")) return stripped;
  const kept = stripped
    .slice(query + 1)
    .split("&")
    .filter((part) => part && !USER_KEY.test(decodeURIComponent(part.split("=")[0] ?? "")));
  return kept.length ? `${stripped.slice(0, query)}?${kept.join("&")}` : stripped.slice(0, query);
}

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/ä/g, "ae")
      .replace(/ö/g, "oe")
      .replace(/ü/g, "ue")
      .replace(/ß/g, "ss")
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "verbindung"
  );
}

export function teamEntry(connection: SavedConnection, suffix: string): Record<string, unknown> {
  const entry: Record<string, unknown> = {
    id: `${slug(connection.name)}-${suffix}`,
    name: connection.name,
    kind: connection.kind,
    connectionString: withoutUser(persistedConnectionString(connection.connectionString)),
  };
  for (const field of OPTIONAL) {
    const value = connection[field];
    if (value !== undefined && value !== null && !(Array.isArray(value) && !value.length))
      entry[field] = value;
  }
  if (connection.ssh?.host) {
    const { keyFile: _key, agentSocket: _socket, jumpHosts, ...ssh } = connection.ssh;
    entry.ssh = {
      ...ssh,
      keyFile: "",
      ...(jumpHosts?.length
        ? { jumpHosts: jumpHosts.map(({ agentSocket: _a, ...hop }) => ({ ...hop, keyFile: "" })) }
        : {}),
    };
  }
  return entry;
}

export function shareProblem(connection: SavedConnection): string | null {
  if (connection.team) return "Diese Verbindung kommt bereits von deiner Organisation.";
  if (connection.temporary) return "Temporäre Verbindungen erst speichern.";
  if (connection.commandTunnel?.command)
    return "Verbindungen mit Befehls-Tunnel lassen sich nicht teilen.";
  const check = mergeTeamConnections(
    [],
    MICROSOFT_HUB,
    [teamEntry(connection, "check")],
    useTeamStore.getState().allowedHosts,
  );
  return check.connections.length
    ? null
    : (check.warnings[0] ?? "Diese Verbindung lässt sich nicht teilen.");
}

export async function shareTeamConnection(
  connectionId: string,
  folder: string,
): Promise<SavedConnection> {
  const connection = useConnectionsStore
    .getState()
    .connections.find((entry) => entry.id === connectionId);
  if (!connection) throw new Error("Verbindung nicht gefunden.");
  const problem = shareProblem(connection);
  if (problem) throw new Error(problem);
  const entry = teamEntry(connection, crypto.randomUUID().slice(0, 6));
  const { entryId } = await teamShare(folder, connection.name, entry);
  const [merged] = mergeTeamConnections(
    [],
    MICROSOFT_HUB,
    [{ ...entry, id: entryId }],
    useTeamStore.getState().allowedHosts,
  ).connections;
  const next: SavedConnection = { ...connection, team: merged.team };
  useConnectionsStore.setState((state) => ({
    connections: state.connections.map((item) => (item.id === connection.id ? next : item)),
  }));
  return next;
}
