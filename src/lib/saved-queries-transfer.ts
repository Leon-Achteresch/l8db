import type { SavedQuery } from "@/lib/saved-queries";

export const SAVED_QUERY_EXPORT_FORMAT = "l8db-saved-queries";
export const SAVED_QUERY_EXPORT_VERSION = 1;

export interface ExportedSavedQuery {
  id: string;
  name: string;
  sql: string;
  createdAt: number;
}

export interface SavedQueryExportFile {
  format: typeof SAVED_QUERY_EXPORT_FORMAT;
  version: number;
  exportedAt: string;
  queries: ExportedSavedQuery[];
}

export type SavedQueryDuplicateStrategy = "skip" | "copy";

export interface SavedQueryImportCandidate {
  index: number;
  query: ExportedSavedQuery | null;
  label: string;
  error: string | null;
  duplicateOf: SavedQuery | null;
}

export interface ParsedSavedQueryImport {
  candidates: SavedQueryImportCandidate[];
  error: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
    return crypto.randomUUID();
  return `sq-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function toExportedSavedQuery(query: SavedQuery): ExportedSavedQuery {
  return {
    id: query.id,
    name: query.name,
    sql: query.sql,
    createdAt: query.createdAt,
  };
}

export function buildSavedQueryExport(
  queries: SavedQuery[],
  now: Date = new Date(),
): SavedQueryExportFile {
  return {
    format: SAVED_QUERY_EXPORT_FORMAT,
    version: SAVED_QUERY_EXPORT_VERSION,
    exportedAt: now.toISOString(),
    queries: queries.map(toExportedSavedQuery),
  };
}

export function serializeSavedQueryExport(queries: SavedQuery[], now: Date = new Date()): string {
  return JSON.stringify(buildSavedQueryExport(queries, now), null, 2);
}

function parseEntry(value: unknown): ExportedSavedQuery | string {
  if (!isRecord(value)) return "Eintrag ist kein Objekt.";
  const name = typeof value.name === "string" ? value.name.trim() : "";
  if (!name) return "Name fehlt.";
  if (typeof value.sql !== "string" || value.sql.trim().length === 0) return "SQL fehlt.";
  const createdAt = Number(value.createdAt);
  return {
    id: typeof value.id === "string" && value.id ? value.id : newId(),
    name,
    sql: value.sql,
    createdAt: Number.isFinite(createdAt) && createdAt > 0 ? createdAt : Date.now(),
  };
}

export function findSavedQueryDuplicate(
  query: ExportedSavedQuery,
  existing: SavedQuery[],
): SavedQuery | null {
  return (
    existing.find((entry) => entry.id === query.id) ??
    existing.find((entry) => entry.name.trim().toLowerCase() === query.name.trim().toLowerCase()) ??
    null
  );
}

export function parseSavedQueryImport(
  text: string,
  existing: SavedQuery[],
): ParsedSavedQueryImport {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { candidates: [], error: "Die Datei enthält kein gültiges JSON." };
  }
  if (!isRecord(raw)) return { candidates: [], error: "Die Datei hat kein bekanntes Format." };
  if (raw.format !== SAVED_QUERY_EXPORT_FORMAT)
    return { candidates: [], error: "Die Datei ist kein l8db-Query-Export." };
  if (typeof raw.version !== "number" || raw.version > SAVED_QUERY_EXPORT_VERSION)
    return {
      candidates: [],
      error: `Exportversion ${String(raw.version)} wird nicht unterstützt (maximal ${SAVED_QUERY_EXPORT_VERSION}).`,
    };
  if (!Array.isArray(raw.queries))
    return { candidates: [], error: "Die Datei enthält keine Query-Liste." };
  const candidates = raw.queries.map((entry, index) => {
    const parsed = parseEntry(entry);
    if (typeof parsed === "string") {
      const label =
        isRecord(entry) && typeof entry.name === "string" && entry.name.trim()
          ? entry.name.trim()
          : `Eintrag ${index + 1}`;
      return { index, query: null, label, error: parsed, duplicateOf: null };
    }
    return {
      index,
      query: parsed,
      label: parsed.name,
      error: null,
      duplicateOf: findSavedQueryDuplicate(parsed, existing),
    };
  });
  return { candidates, error: null };
}

export function uniqueCopyName(name: string, taken: string[]): string {
  const used = new Set(taken.map((entry) => entry.trim().toLowerCase()));
  const base = `${name} (Kopie)`;
  if (!used.has(base.toLowerCase())) return base;
  let counter = 2;
  while (used.has(`${name} (Kopie ${counter})`.toLowerCase())) counter += 1;
  return `${name} (Kopie ${counter})`;
}

export function resolveSavedQueryImport(
  candidates: SavedQueryImportCandidate[],
  selected: Set<number>,
  strategy: SavedQueryDuplicateStrategy,
  existing: SavedQuery[] = [],
): SavedQuery[] {
  const result: SavedQuery[] = [];
  const taken = existing.map((entry) => entry.name);
  for (const candidate of candidates) {
    if (!candidate.query || candidate.error || !selected.has(candidate.index)) continue;
    if (candidate.duplicateOf) {
      if (strategy === "skip") continue;
      const name = uniqueCopyName(candidate.query.name, taken);
      taken.push(name);
      result.push({
        id: newId(),
        name,
        sql: candidate.query.sql,
        createdAt: candidate.query.createdAt,
      });
      continue;
    }
    taken.push(candidate.query.name);
    result.push({
      id: candidate.query.id,
      name: candidate.query.name,
      sql: candidate.query.sql,
      createdAt: candidate.query.createdAt,
    });
  }
  return result;
}
