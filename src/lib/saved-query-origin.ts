import type { SavedQuery } from "./saved-queries";

export interface SavedQueryOrigin {
  connectionId: string;
  connectionName?: string;
  database: string | null;
}

export interface SavedQueryOriginInfo {
  label: string;
  title: string;
}

function contextText(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim() || value.length > 256) return undefined;
  if (
    /[\p{Cc}\u2028-\u202e\u2066-\u2069]|:\/\/|[^:\s]+:[^@\s]+@|\b(?:password|passwd|pwd|token|secret)\s*=/iu.test(
      value,
    )
  )
    return undefined;
  return value;
}

export function sanitizeSavedQueryOrigin(value: unknown): SavedQueryOrigin | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  const connectionId = contextText(input.connectionId);
  if (!connectionId) return undefined;
  const connectionName = contextText(input.connectionName);
  return {
    connectionId,
    ...(connectionName ? { connectionName } : {}),
    database: contextText(input.database) ?? null,
  };
}

export function captureSavedQueryOrigin(
  connection: { id: string; name: string } | null | undefined,
  database: string | null,
): SavedQueryOrigin | undefined {
  return connection
    ? sanitizeSavedQueryOrigin({
        connectionId: connection.id,
        connectionName: connection.name,
        database,
      })
    : undefined;
}

export function savedQueryOriginKey(origin: SavedQueryOrigin | undefined): string | null {
  const clean = sanitizeSavedQueryOrigin(origin);
  return clean ? JSON.stringify(clean) : null;
}

export function savedQueryOriginForSave(
  origin: SavedQueryOrigin | undefined,
  selectedKey: string | null,
): SavedQueryOrigin | null {
  return selectedKey !== null && selectedKey === savedQueryOriginKey(origin)
    ? (sanitizeSavedQueryOrigin(origin) ?? null)
    : null;
}

export function toStoredSavedQuery(
  query: Pick<SavedQuery, "id" | "name" | "sql" | "createdAt"> & { origin?: unknown },
): SavedQuery {
  const origin = sanitizeSavedQueryOrigin(query.origin);
  return {
    id: query.id,
    name: query.name,
    sql: query.sql,
    createdAt: query.createdAt,
    ...(origin ? { origin } : {}),
  };
}

export function storedSavedQueries(value: unknown): SavedQuery[] | null {
  if (!Array.isArray(value)) return null;
  return value
    .filter(
      (item): item is SavedQuery =>
        item &&
        typeof item === "object" &&
        typeof item.id === "string" &&
        typeof item.name === "string" &&
        typeof item.sql === "string" &&
        typeof item.createdAt === "number" &&
        Number.isFinite(item.createdAt),
    )
    .map(toStoredSavedQuery);
}

export function savedQueryConnectionNames(
  connections: readonly { id: string; name: string }[],
): Map<string, string | null> {
  return new Map(
    connections.map((connection) => [connection.id, contextText(connection.name) ?? null]),
  );
}

export function savedQueryOriginInfo(
  origin: SavedQueryOrigin | undefined,
  names: ReadonlyMap<string, string | null>,
): SavedQueryOriginInfo {
  const clean = sanitizeSavedQueryOrigin(origin);
  const disclaimer =
    "Herkunftshinweis, kein Ausführungsziel. Öffnen wechselt keine Verbindung; Ziel und SQL vor dem Ausführen prüfen.";
  if (!clean) return { label: "Allgemein", title: `Ohne gespeicherte Herkunft. ${disclaimer}` };
  const current = names.get(clean.connectionId);
  const previous = clean.connectionName;
  const name = !names.has(clean.connectionId)
    ? `${previous ?? "Verbindung"} (nicht verfügbar)`
    : current === null || current === undefined
      ? `${previous ?? "Verbindung"} (lokaler Name unbekannt)`
      : previous && current !== previous
        ? `${current} (gespeichert als ${previous})`
        : current;
  return {
    label: `${name} · ${clean.database ?? "Datenbank unbekannt"}`,
    title: `${name} · ${clean.database ?? "Datenbank beim Speichern unbekannt"}. ${disclaimer}`,
  };
}

export function matchesSavedQuerySearch(
  query: SavedQuery,
  normalizedSearch: string,
  names: ReadonlyMap<string, string | null>,
): boolean {
  const text = normalizedSearch;
  return (
    !text ||
    query.name.toLowerCase().includes(text) ||
    query.sql.toLowerCase().includes(text) ||
    savedQueryOriginInfo(query.origin, names).label.toLowerCase().includes(text)
  );
}
