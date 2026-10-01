import { connectionSummary } from "@/lib/connection-url";
import type { SavedConnection } from "@/lib/connections";
import { isVersioningKind } from "./model";
import type {
  DatabaseTarget,
  TargetStore,
  TeamConfiguration,
  TeamConnection,
  TeamTarget,
} from "./types";

export const TEAM_PATH = "database/team.json";

const fields = [
  "id",
  "name",
  "customer",
  "environment",
  "connectionRef",
  "database",
  "schema",
  "production",
  "track",
  "pinnedRelease",
  "paused",
  "ledgerSchema",
  "expectedPhysicalKey",
  "requireApproval",
  "operators",
  "administrators",
  "reviewers",
] as const;

const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));
const text = (value: unknown): value is string =>
  typeof value === "string" &&
  Boolean(value.trim()) &&
  value.length <= 500 &&
  !value.includes("\0");
const exact = (value: unknown, keys: readonly string[]) =>
  object(value) && Object.keys(value).every((key) => keys.includes(key));

export function parseTeamConfiguration(raw: string, projectId: string): TeamConfiguration {
  const team = JSON.parse(raw) as TeamConfiguration;
  if (
    !exact(team, ["format", "projectId", "connections", "targets", "branches"]) ||
    team.format !== 1 ||
    team.projectId !== projectId ||
    !Array.isArray(team.connections) ||
    !Array.isArray(team.targets) ||
    !object(team.branches)
  )
    throw new Error("Git-Teamkonfiguration ist ungültig oder gehört zu einem anderen Projekt.");
  const refs = new Set<string>();
  for (const connection of team.connections) {
    if (
      !exact(connection, [
        "id",
        "name",
        "kind",
        "host",
        "port",
        "service",
        "sslMode",
        "requiresTunnel",
      ]) ||
      !text(connection.id) ||
      refs.has(connection.id) ||
      !text(connection.name) ||
      !isVersioningKind(connection.kind) ||
      !text(connection.host) ||
      (!["sqlite", "duckdb"].includes(connection.kind) &&
        (!/^\d{1,5}$/.test(connection.port) ||
          Number(connection.port) < 1 ||
          Number(connection.port) > 65535)) ||
      (["sqlite", "duckdb"].includes(connection.kind) && connection.port !== "") ||
      (connection.service !== null && !text(connection.service)) ||
      !["disable", "prefer", "require", "verify-ca", "verify-full"].includes(connection.sslMode) ||
      typeof connection.requiresTunnel !== "boolean"
    )
      throw new Error(
        "Gemeinsame Verbindung ist ungültig. Zugangsdaten gehören in lokale Profile.",
      );
    refs.add(connection.id);
  }
  const ids = new Set<string>();
  for (const target of team.targets) {
    if (
      !exact(target, fields) ||
      !text(target.id) ||
      ids.has(target.id) ||
      !text(target.name) ||
      !refs.has(target.connectionRef) ||
      (target.database !== null && !text(target.database)) ||
      !text(target.schema) ||
      typeof target.production !== "boolean" ||
      [target.customer, target.environment, target.ledgerSchema].some(
        (value) => value !== undefined && !text(value),
      ) ||
      (target.track !== undefined && !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(target.track)) ||
      (target.pinnedRelease !== undefined &&
        target.pinnedRelease !== null &&
        !text(target.pinnedRelease)) ||
      [target.paused, target.requireApproval].some(
        (value) => value !== undefined && typeof value !== "boolean",
      ) ||
      (target.expectedPhysicalKey !== undefined &&
        !/^[a-f0-9]{64}$/.test(target.expectedPhysicalKey)) ||
      [target.operators, target.reviewers, target.administrators].some(
        (value) =>
          value !== undefined && (!Array.isArray(value) || value.some((entry) => !text(entry))),
      )
    )
      throw new Error("Gemeinsame Kundenzuordnung ist ungültig.");
    ids.add(target.id);
  }
  for (const [branch, value] of Object.entries(team.branches)) {
    if (
      !text(branch) ||
      !exact(value, ["targetId", "source"]) ||
      (value.targetId !== undefined && !ids.has(value.targetId)) ||
      (value.source !== undefined &&
        (!exact(value.source, ["connectionRef", "database", "schema"]) ||
          !refs.has(value.source.connectionRef) ||
          (value.source.database !== null && !text(value.source.database)) ||
          (value.source.schema !== null && !text(value.source.schema))))
    )
      throw new Error("Gemeinsame Branch-Zuordnung ist ungültig.");
  }
  return team;
}

export function describeTeamConnection(connection: SavedConnection): TeamConnection {
  if (!isVersioningKind(connection.kind))
    throw new Error("Diese Verbindung unterstützt keine Datenbankversionierung.");
  const file = connection.kind === "sqlite" || connection.kind === "duckdb";
  const endpoint = connectionSummary(connection.connectionString, connection.kind);
  if (!file && (!endpoint.port || !endpoint.host || endpoint.host === "Ungültiger Endpunkt"))
    throw new Error("Der Verbindungsendpunkt kann nicht ohne Zugangsdaten geteilt werden.");
  return {
    id: crypto.randomUUID(),
    name: connection.name,
    kind: connection.kind,
    host: file ? "local-file" : endpoint.host,
    port: file ? "" : endpoint.port,
    service: connection.kind === "oracle" ? endpoint.database || null : null,
    sslMode: connection.sslMode,
    requiresTunnel: Boolean(connection.ssh?.host || connection.proxy?.host),
  };
}

export function ensureTeamConnection(store: TargetStore, connection: SavedConnection): string {
  store.connections ??= [];
  store.connectionBindings ??= {};
  const ref =
    Object.entries(store.connectionBindings).find(([, id]) => id === connection.id)?.[0] ??
    store.targets.find((target) => target.connectionId === connection.id && target.connectionRef)
      ?.connectionRef;
  if (ref && store.connections.some((entry) => entry.id === ref)) return ref;
  const descriptor = describeTeamConnection(connection);
  store.connections.push(descriptor);
  store.connectionBindings[descriptor.id] = connection.id;
  return descriptor.id;
}

export function teamTarget(target: DatabaseTarget): TeamTarget {
  if (!target.connectionRef) throw new Error("Gemeinsame Verbindungsreferenz fehlt.");
  const shared: Record<string, unknown> = {};
  for (const field of fields) if (target[field] !== undefined) shared[field] = target[field];
  shared.expectedPhysicalKey = target.expectedPhysicalKey ?? target.binding?.physicalKey;
  return shared as unknown as TeamTarget;
}

export function createTeamConfiguration(
  store: TargetStore,
  connections: SavedConnection[],
): TeamConfiguration {
  for (const target of store.targets) {
    if (!target.connectionRef) {
      const connection = connections.find((entry) => entry.id === target.connectionId);
      if (!connection)
        throw new Error(`Lokale Verbindung für ${target.name} vor dem Teilen zuordnen.`);
      target.connectionRef = ensureTeamConnection(store, connection);
    }
    target.expectedPhysicalKey ??= target.binding?.physicalKey;
    if (target.connectionId) {
      store.connectionBindings ??= {};
      store.connectionBindings[target.connectionRef] = target.connectionId;
    }
  }
  if (!store.teamConfigured && typeof localStorage !== "undefined") {
    store.branches ??= {};
    const sourcePrefix = `l8db.versioning.source.${store.projectId}.`;
    const targetPrefix = `l8db.versioning.branch-target.${store.projectId}.`;
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (!key) continue;
      if (key.startsWith(targetPrefix)) {
        const id = localStorage.getItem(key);
        if (id && store.targets.some((target) => target.id === id && !target.production)) {
          const branch = key.slice(targetPrefix.length);
          store.branches[branch] = { ...store.branches[branch], targetId: id };
        }
      }
      if (key.startsWith(sourcePrefix)) {
        const value = JSON.parse(localStorage.getItem(key) ?? "null");
        if (!object(value) || !text(value.connectionId)) continue;
        const connection = connections.find((entry) => entry.id === value.connectionId);
        if (!connection) throw new Error("Lokale Entwicklungsverbindung vor dem Teilen zuordnen.");
        const branch = key.slice(sourcePrefix.length);
        store.branches[branch] = {
          ...store.branches[branch],
          source: {
            connectionRef: ensureTeamConnection(store, connection),
            database: typeof value.database === "string" ? value.database : null,
            schema: typeof value.schema === "string" ? value.schema : null,
          },
        };
      }
    }
  }
  const result: TeamConfiguration = {
    format: 1,
    projectId: store.projectId,
    connections: store.connections ?? [],
    targets: store.targets.map(teamTarget),
    branches: store.branches ?? {},
  };
  return parseTeamConfiguration(JSON.stringify(result), store.projectId);
}

export function mergeTeamTargets(local: TargetStore, team: TeamConfiguration): TargetStore {
  return {
    format: 1,
    projectId: team.projectId,
    connections: team.connections,
    branches: team.branches,
    teamConfigured: true,
    connectionBindings: local.connectionBindings ?? {},
    targets: team.targets.map((shared) => {
      const previous = local.targets.find((target) => target.id === shared.id);
      const sameLocation =
        previous &&
        previous.connectionRef === shared.connectionRef &&
        previous.database === shared.database &&
        previous.schema === shared.schema &&
        (previous.ledgerSchema ?? previous.schema) === (shared.ledgerSchema ?? shared.schema) &&
        (!shared.expectedPhysicalKey ||
          previous.binding?.physicalKey === shared.expectedPhysicalKey);
      return {
        ...shared,
        connectionId:
          local.connectionBindings?.[shared.connectionRef] ??
          (previous?.connectionRef === shared.connectionRef ? previous.connectionId : ""),
        binding: sameLocation ? previous.binding : undefined,
        release: sameLocation ? previous.release : null,
        history: sameLocation ? previous.history : [],
      };
    }),
  };
}
