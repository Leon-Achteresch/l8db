import { createConnectionId, type SavedConnection } from "@/lib/connections";
import type { DatabaseKind, SslMode } from "@/lib/db";
import { isToadExport, parseToadExport } from "@/lib/toad-import";
import { stripConnectionSecrets } from "./export";
import { toCandidate } from "./resolve";
import {
  CONNECTION_EXPORT_FORMAT,
  CONNECTION_EXPORT_VERSION,
  type ExportedConnection,
  type ExportedSsh,
  KINDS,
  SSL_MODES,
} from "./types";

export type DuplicateStrategy = "skip" | "copy";

export interface ImportCandidate {
  index: number;
  profile: ExportedConnection | null;
  label: string;
  error: string | null;
  duplicateOf: SavedConnection | null;
}

export interface ParsedConnectionImport {
  candidates: ImportCandidate[];
  error: string | null;
  source: "l8db" | "toad";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSsh(value: unknown): ExportedSsh | null | string {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) return "SSH-Konfiguration ist kein Objekt.";
  const host = typeof value.host === "string" ? value.host : "";
  if (!host) return null;
  const port = Number(value.port ?? 22);
  const remotePort = Number(value.remotePort ?? 0);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return "SSH-Port ist ungültig.";
  if (!Number.isInteger(remotePort) || remotePort <= 0 || remotePort > 65535)
    return "SSH-Zielport ist ungültig.";
  const auth = value.auth === "password" ? "password" : "key";
  return {
    host,
    port,
    user: typeof value.user === "string" ? value.user : "",
    auth,
    keyFile: typeof value.keyFile === "string" ? value.keyFile : "",
    remoteHost: typeof value.remoteHost === "string" ? value.remoteHost : "",
    remotePort,
  };
}

function parseProfile(value: unknown): ExportedConnection | string {
  if (!isRecord(value)) return "Eintrag ist kein Objekt.";
  const name = typeof value.name === "string" ? value.name.trim() : "";
  if (!name) return "Name fehlt.";
  const kind = value.kind;
  if (typeof kind !== "string" || !KINDS.includes(kind as DatabaseKind))
    return `Unbekannter Datenbanktyp „${String(kind)}“.`;
  const connectionString =
    typeof value.connectionString === "string" ? value.connectionString.trim() : "";
  if (!connectionString) return "Verbindungsparameter fehlen.";
  const sslMode =
    typeof value.sslMode === "string" && SSL_MODES.includes(value.sslMode as SslMode)
      ? (value.sslMode as SslMode)
      : "prefer";
  const ssh = parseSsh(value.ssh);
  if (typeof ssh === "string") return ssh;
  const tags = Array.isArray(value.tags)
    ? value.tags
        .filter(isRecord)
        .filter((tag) => typeof tag.name === "string" && tag.name.trim().length > 0)
        .map((tag) => ({
          name: String(tag.name).trim(),
          color: typeof tag.color === "string" ? tag.color : "#64748b",
        }))
    : [];
  return {
    id: typeof value.id === "string" && value.id ? value.id : createConnectionId(),
    name,
    kind: kind as DatabaseKind,
    connectionString: stripConnectionSecrets(connectionString),
    sslMode,
    ssh,
    tags,
    favorite: value.favorite === true,
    color: typeof value.color === "string" && value.color ? value.color : null,
    schemas: Array.isArray(value.schemas)
      ? value.schemas.filter((entry): entry is string => typeof entry === "string" && entry !== "")
      : null,
  };
}

export function findDuplicate(
  profile: ExportedConnection,
  existing: SavedConnection[],
): SavedConnection | null {
  return (
    existing.find((connection) => connection.id === profile.id) ??
    existing.find(
      (connection) =>
        connection.name === profile.name &&
        connection.kind === profile.kind &&
        stripConnectionSecrets(connection.connectionString) === profile.connectionString,
    ) ??
    null
  );
}

export function parseConnectionImport(
  text: string,
  existing: SavedConnection[],
): ParsedConnectionImport {
  if (isToadExport(text)) {
    const candidates = parseToadExport(text).map((parsed, index) =>
      toCandidate(parsed, index, `Eintrag ${index + 1}`, existing),
    );
    return { candidates, error: null, source: "toad" };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return {
      candidates: [],
      error: "Die Datei enthält weder gültiges JSON noch einen Toad-Export.",
      source: "l8db",
    };
  }
  if (!isRecord(raw))
    return { candidates: [], error: "Die Datei hat kein bekanntes Format.", source: "l8db" };
  if (raw.format !== CONNECTION_EXPORT_FORMAT)
    return {
      candidates: [],
      error: "Die Datei ist kein l8db-Verbindungsexport.",
      source: "l8db",
    };
  if (typeof raw.version !== "number" || raw.version > CONNECTION_EXPORT_VERSION)
    return {
      candidates: [],
      error: `Exportversion ${String(raw.version)} wird nicht unterstützt (maximal ${CONNECTION_EXPORT_VERSION}).`,
      source: "l8db",
    };
  if (!Array.isArray(raw.connections))
    return { candidates: [], error: "Die Datei enthält keine Verbindungsliste.", source: "l8db" };
  const candidates: ImportCandidate[] = raw.connections.map((entry, index) =>
    toCandidate(
      parseProfile(entry),
      index,
      isRecord(entry) && typeof entry.name === "string" && entry.name
        ? entry.name
        : `Eintrag ${index + 1}`,
      existing,
    ),
  );
  return { candidates, error: null, source: "l8db" };
}
