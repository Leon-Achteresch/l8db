import type { SavedConnection } from "@/lib/connections";
import { extractUrlPassword, injectUrlPassword, scrubUrlPassword } from "@/lib/secrets";
import type { Json, VaultConnection } from "../../../packages/extension-api/src";
import { toExportedConnection } from "./export";
import { parseConnectionImport } from "./parse";
import { resolveImport } from "./resolve";
import { CONNECTION_EXPORT_FORMAT, CONNECTION_EXPORT_VERSION } from "./types";

export function toVaultConnection(
  connection: SavedConnection,
  storedPassword: string | null,
): VaultConnection {
  const password = extractUrlPassword(connection.connectionString) ?? storedPassword;
  const isUrl = connection.connectionString.includes("://");
  return {
    id: connection.id,
    name: connection.name,
    kind: connection.kind,
    connectionString: isUrl
      ? scrubUrlPassword(connection.connectionString)
      : connection.connectionString,
    password,
    profile: toExportedConnection(connection) as unknown as Json,
  };
}

export interface VaultMerge {
  added: SavedConnection[];
  updated: SavedConnection[];
  skipped: string[];
  passwords: Map<string, string>;
}

function withSecret(item: VaultConnection): string {
  if (!item.connectionString.includes("://") || !item.password) return item.connectionString;
  return injectUrlPassword(item.connectionString, item.password);
}

export function mergeVaultConnections(
  items: VaultConnection[],
  existing: SavedConnection[],
): VaultMerge {
  const result: VaultMerge = { added: [], updated: [], skipped: [], passwords: new Map() };
  const valid = items.filter((item) => {
    const ok =
      typeof item === "object" &&
      item !== null &&
      typeof item.connectionString === "string" &&
      (item.password === null || typeof item.password === "string") &&
      typeof item.profile === "object" &&
      item.profile !== null;
    if (!ok) result.skipped.push(typeof item?.name === "string" ? item.name : "?");
    return ok;
  });
  const parsed = parseConnectionImport(
    JSON.stringify({
      format: CONNECTION_EXPORT_FORMAT,
      version: CONNECTION_EXPORT_VERSION,
      connections: valid.map((item) => item.profile),
    }),
    existing,
  );
  for (const candidate of parsed.candidates) {
    const item = valid[candidate.index];
    if (!candidate.profile || candidate.error) {
      result.skipped.push(candidate.label);
      continue;
    }
    const [resolved] = resolveImport(
      [{ ...candidate, duplicateOf: null }],
      new Set([candidate.index]),
      "skip",
    );
    const connectionString = withSecret(item);
    const target = candidate.duplicateOf;
    const next: SavedConnection = target
      ? { ...target, ...resolved, id: target.id, connectionString }
      : { ...resolved, connectionString };
    if (target) result.updated.push(next);
    else result.added.push(next);
    if (item.password) result.passwords.set(next.id, item.password);
  }
  return result;
}
