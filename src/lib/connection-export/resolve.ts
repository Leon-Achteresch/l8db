import type { HostGroupRule } from "@/lib/connection-groups";
import { createConnectionId, type SavedConnection, type SshConnection } from "@/lib/connections";
import { connectionEnvironment } from "@/lib/environments";
import { type DuplicateStrategy, findDuplicate, type ImportCandidate } from "./parse";
import type { ExportedConnection } from "./types";

export function toCandidate(
  parsed: ExportedConnection | string,
  index: number,
  fallbackLabel: string,
  existing: SavedConnection[],
): ImportCandidate {
  if (typeof parsed === "string")
    return { index, profile: null, label: fallbackLabel, error: parsed, duplicateOf: null };
  return {
    index,
    profile: parsed,
    label: parsed.name,
    error: null,
    duplicateOf: findDuplicate(parsed, existing),
  };
}

function toSavedConnection(profile: ExportedConnection): SavedConnection {
  const ssh: SshConnection | null = profile.ssh
    ? {
        ...profile.ssh,
        ...(profile.ssh.jumpHosts
          ? { jumpHosts: profile.ssh.jumpHosts.map((jump) => ({ ...jump })) }
          : {}),
      }
    : null;
  return {
    id: profile.id,
    name: profile.name,
    kind: profile.kind,
    connectionString: profile.connectionString,
    sslMode: profile.sslMode,
    ssh,
    proxy: profile.proxy ? { ...profile.proxy } : null,
    tunnelPort: null,
    tags: profile.tags,
    favorite: profile.favorite,
    color: profile.color,
    schemas: profile.schemas?.length ? profile.schemas : null,
    showSingleSchemaSwitcher: profile.showSingleSchemaSwitcher,
    ...(profile.environment !== undefined ? { environment: profile.environment } : {}),
    ...(profile.readOnly !== undefined ? { readOnly: profile.readOnly } : {}),
    ...(profile.maskRules ? { maskRules: profile.maskRules.map((rule) => ({ ...rule })) } : {}),
  };
}

export function keepRuleProduction(
  connection: SavedConnection,
  rules?: HostGroupRule[],
): SavedConnection {
  if (!connection.environment || connection.environment === "production") return connection;
  if (connectionEnvironment({ ...connection, environment: null }, rules) !== "production")
    return connection;
  const next = { ...connection };
  delete next.environment;
  return next;
}

export function resolveImport(
  candidates: ImportCandidate[],
  selected: Set<number>,
  strategy: DuplicateStrategy,
  rules?: HostGroupRule[],
): SavedConnection[] {
  const result: SavedConnection[] = [];
  for (const candidate of candidates) {
    if (!candidate.profile || candidate.error || !selected.has(candidate.index)) continue;
    if (candidate.duplicateOf) {
      if (strategy === "skip") continue;
      result.push(
        keepRuleProduction(
          {
            ...toSavedConnection(candidate.profile),
            id: createConnectionId(),
            name: `${candidate.profile.name} (Kopie)`,
          },
          rules,
        ),
      );
      continue;
    }
    result.push(keepRuleProduction(toSavedConnection(candidate.profile), rules));
  }
  return result;
}
