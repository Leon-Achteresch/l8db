import { createConnectionId, type SavedConnection, type SshConnection } from "@/lib/connections";
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
  };
}

export function resolveImport(
  candidates: ImportCandidate[],
  selected: Set<number>,
  strategy: DuplicateStrategy,
): SavedConnection[] {
  const result: SavedConnection[] = [];
  for (const candidate of candidates) {
    if (!candidate.profile || candidate.error || !selected.has(candidate.index)) continue;
    if (candidate.duplicateOf) {
      if (strategy === "skip") continue;
      result.push({
        ...toSavedConnection(candidate.profile),
        id: createConnectionId(),
        name: `${candidate.profile.name} (Kopie)`,
      });
      continue;
    }
    result.push(toSavedConnection(candidate.profile));
  }
  return result;
}
