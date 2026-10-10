export const SYNC_FORMAT = "l8db-sync";
export const SYNC_SCHEMA_VERSION = 1;
export const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
export const DELETED = "-";

export const SYNC_COLLECTIONS = [
  "connections",
  "hostGroupRules",
  "connectionPrefs",
  "savedQueries",
  "snippets",
  "history",
  "workspace",
] as const;

export type SyncCollection = (typeof SYNC_COLLECTIONS)[number];

export const SYNC_COLLECTION_LABELS: Record<SyncCollection, string> = {
  connections: "Verbindungen",
  hostGroupRules: "Servergruppen",
  connectionPrefs: "Server-Favoriten & Reihenfolge",
  savedQueries: "Gespeicherte Abfragen",
  snippets: "Snippets",
  history: "Query-Verlauf",
  workspace: "Einstellungen & Layouts",
};

export interface LocalItem {
  id: string;
  data: unknown;
  updatedAt?: number;
  source?: object;
}

export type LocalCollections = Record<SyncCollection, LocalItem[]>;

export interface SyncEntry {
  hash: string;
  updatedAt: number;
  data: unknown;
}

export interface SyncSnapshot {
  items: Map<string, SyncEntry>;
  tombstones: Map<string, number>;
}

export type SyncBase = Map<string, [string, number]>;

export interface DevicePathHint {
  collection: SyncCollection;
  id: string;
  field: string;
}

export interface SyncDocument {
  format: typeof SYNC_FORMAT;
  schemaVersion: number;
  deviceId: string;
  updatedAt: number;
  contentHash: string;
  items: Partial<Record<SyncCollection, Record<string, DocumentItem>>>;
  tombstones: Partial<Record<SyncCollection, Record<string, number>>>;
  secrets: string | null;
  secretsFingerprint?: string | null;
  hints: { devicePaths: DevicePathHint[] };
  extra?: SyncExtra;
}

export interface DocumentItem {
  updatedAt: number;
  data: unknown;
  h?: string;
}

export interface SyncExtra {
  items: Record<string, unknown>;
  tombstones: Record<string, unknown>;
}

export interface EncryptedSyncDocument {
  format: typeof SYNC_FORMAT;
  schemaVersion: number;
  deviceId: string;
  updatedAt: number;
  contentHash: string;
  encrypted: string;
}

export function itemKey(collection: SyncCollection, id: string): string {
  return `${collection}:${id}`;
}

export function splitKey(key: string): { collection: SyncCollection; id: string } {
  const index = key.indexOf(":");
  return { collection: key.slice(0, index) as SyncCollection, id: key.slice(index + 1) };
}

function sortKeys(_key: string, value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    if (key !== "__proto__") sorted[key] = (value as Record<string, unknown>)[key];
  }
  return sorted;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, sortKeys) ?? "null";
}

function finish(a: number, b: number): number {
  const h1 = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909);
  const h2 = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

export function hashText(text: string): string {
  let a1 = 0xdeadbeef ^ 1;
  let a2 = 0x41c6ce57 ^ 1;
  let b1 = 0xdeadbeef ^ 7;
  let b2 = 0x41c6ce57 ^ 7;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    a1 = Math.imul(a1 ^ code, 2654435761);
    a2 = Math.imul(a2 ^ code, 1597334677);
    b1 = Math.imul(b1 ^ code, 2246822519);
    b2 = Math.imul(b2 ^ code, 3266489917);
  }
  return `${finish(a1, a2).toString(36)}.${finish(b1, b2).toString(36)}`;
}

const HASHES = new WeakMap<object, string>();

export function hashData(data: unknown, source?: object): string {
  const key = source ?? (data !== null && typeof data === "object" ? data : null);
  if (key) {
    const cached = HASHES.get(key);
    if (cached !== undefined) return cached;
  }
  const hash = hashText(canonicalJson(data));
  if (key) HASHES.set(key, hash);
  return hash;
}

export function buildSnapshot(
  collections: LocalCollections,
  base: SyncBase,
  now: number,
): SyncSnapshot {
  const items = new Map<string, SyncEntry>();
  for (const collection of SYNC_COLLECTIONS) {
    for (const item of collections[collection]) {
      const key = itemKey(collection, item.id);
      const hash = hashData(item.data, item.source);
      const known = base.get(key);
      const updatedAt =
        known && known[0] === hash
          ? known[1]
          : typeof item.updatedAt === "number" && Number.isFinite(item.updatedAt)
            ? item.updatedAt
            : now;
      items.set(key, { hash, updatedAt, data: item.data });
    }
  }
  const tombstones = new Map<string, number>();
  for (const [key, [hash, at]] of base) {
    if (items.has(key)) continue;
    const deletedAt = hash === DELETED ? at : now;
    if (now - deletedAt <= TOMBSTONE_TTL_MS) tombstones.set(key, deletedAt);
  }
  return { items, tombstones };
}

export function snapshotBase(snapshot: SyncSnapshot): SyncBase {
  const base: SyncBase = new Map();
  for (const [key, entry] of snapshot.items) base.set(key, [entry.hash, entry.updatedAt]);
  for (const [key, deletedAt] of snapshot.tombstones) base.set(key, [DELETED, deletedAt]);
  return base;
}

export function emptySnapshot(): SyncSnapshot {
  return { items: new Map(), tombstones: new Map() };
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function contentSource(
  snapshot: SyncSnapshot,
  secretsFingerprint: string | null,
  extra?: SyncExtra,
): string {
  const lines: string[] = [];
  for (const [key, entry] of snapshot.items) lines.push(`${key}\t${entry.hash}`);
  for (const key of snapshot.tombstones.keys()) lines.push(`${key}\t${DELETED}`);
  lines.sort();
  lines.push(`secrets\t${secretsFingerprint ?? ""}`);
  if (extra) lines.push(`extra\t${hashText(canonicalJson(extra))}`);
  return lines.join("\n");
}

export function contentHash(
  snapshot: SyncSnapshot,
  secretsFingerprint: string | null,
  extra?: SyncExtra,
): Promise<string> {
  return sha256Hex(contentSource(snapshot, secretsFingerprint, extra));
}

const FILE_KINDS = new Set(["sqlite", "duckdb"]);

export function devicePathHints(snapshot: SyncSnapshot): DevicePathHint[] {
  const hints: DevicePathHint[] = [];
  for (const [key, entry] of snapshot.items) {
    const { collection, id } = splitKey(key);
    if (collection !== "connections") continue;
    const connection = entry.data as {
      kind?: string;
      ssh?: {
        keyFile?: string;
        agentSocket?: string;
        jumpHosts?: { keyFile?: string; agentSocket?: string }[];
      } | null;
    };
    if (connection.kind && FILE_KINDS.has(connection.kind))
      hints.push({ collection, id, field: "connectionString" });
    if (connection.ssh?.keyFile) hints.push({ collection, id, field: "ssh.keyFile" });
    if (connection.ssh?.agentSocket) hints.push({ collection, id, field: "ssh.agentSocket" });
    connection.ssh?.jumpHosts?.forEach((jump, index) => {
      if (jump.keyFile) hints.push({ collection, id, field: `ssh.jumpHosts.${index}.keyFile` });
      if (jump.agentSocket)
        hints.push({ collection, id, field: `ssh.jumpHosts.${index}.agentSocket` });
    });
  }
  return hints;
}

export function toDocument(
  snapshot: SyncSnapshot,
  meta: {
    deviceId: string;
    updatedAt: number;
    contentHash: string;
    secrets: string | null;
    secretsFingerprint?: string | null;
    include?: Iterable<SyncCollection>;
    extra?: SyncExtra;
  },
): SyncDocument {
  const items: SyncDocument["items"] = {};
  for (const collection of meta.include ?? []) items[collection] = {};
  for (const [key, entry] of snapshot.items) {
    const { collection, id } = splitKey(key);
    const bucket = items[collection] ?? {};
    items[collection] = bucket;
    bucket[id] = { updatedAt: entry.updatedAt, h: entry.hash, data: entry.data };
  }
  const tombstones: SyncDocument["tombstones"] = {};
  for (const [key, deletedAt] of snapshot.tombstones) {
    const { collection, id } = splitKey(key);
    const bucket = tombstones[collection] ?? {};
    tombstones[collection] = bucket;
    bucket[id] = deletedAt;
  }
  return {
    format: SYNC_FORMAT,
    schemaVersion: SYNC_SCHEMA_VERSION,
    deviceId: meta.deviceId,
    updatedAt: meta.updatedAt,
    contentHash: meta.contentHash,
    items,
    tombstones,
    secrets: meta.secrets,
    ...(meta.secretsFingerprint ? { secretsFingerprint: meta.secretsFingerprint } : {}),
    hints: { devicePaths: devicePathHints(snapshot) },
    ...(meta.extra ? { extra: meta.extra } : {}),
  };
}

export function serializeDocument(document: SyncDocument): string {
  const { extra, ...rest } = document;
  if (!extra) return JSON.stringify(rest);
  return JSON.stringify({
    ...rest,
    items: { ...extra.items, ...rest.items },
    tombstones: { ...extra.tombstones, ...rest.tombstones },
  });
}

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export function parseJsonSafely(source: string): unknown {
  if (![...FORBIDDEN_KEYS].some((key) => source.includes(`"${key}"`))) return JSON.parse(source);
  return JSON.parse(source, (key, value) => {
    if (FORBIDDEN_KEYS.has(key)) throw new Error("Ungültiger Schlüssel in den Sync-Daten.");
    return value;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const str = (value: unknown) => typeof value === "string";
const num = (value: unknown) => typeof value === "number" && Number.isFinite(value);

const ITEM_CHECKS: Record<SyncCollection, (data: Record<string, unknown>, id: string) => boolean> =
  {
    connections: (data, id) =>
      data.id === id && str(data.name) && str(data.kind) && str(data.connectionString),
    hostGroupRules: (data, id) => data.id === id && str(data.name) && str(data.pattern),
    connectionPrefs: (data) => Array.isArray(data.value) && data.value.every(str),
    savedQueries: (data, id) => data.id === id && str(data.name) && str(data.sql),
    snippets: (data, id) =>
      data.id === id && str(data.name) && str(data.body) && str(data.shortcut),
    history: (data, id) =>
      data.id === id && str(data.connectionId) && str(data.sql) && num(data.ranAt),
    workspace: () => true,
  };

const DEVICE_ONLY_FIELDS = ["tunnelPort", "temporary", "commandTunnel"];
const HASH_PATTERN = /^[0-9a-z]{1,12}\.[0-9a-z]{1,12}$/;

function sanitizeData(collection: SyncCollection, data: Record<string, unknown>) {
  if (collection !== "connections" || !DEVICE_ONLY_FIELDS.some((key) => key in data)) return data;
  const { tunnelPort: _port, temporary: _temporary, commandTunnel: _command, ...rest } = data;
  return rest;
}

export function isEncryptedDocument(value: unknown): value is EncryptedSyncDocument {
  return isRecord(value) && value.format === SYNC_FORMAT && typeof value.encrypted === "string";
}

export function parseEnvelope(source: string): SyncDocument | EncryptedSyncDocument {
  const value = parseJsonSafely(source);
  if (!isRecord(value) || value.format !== SYNC_FORMAT)
    throw new Error("Die Remote-Datei ist keine l8db-Synchronisationsdatei.");
  if (!num(value.schemaVersion) || (value.schemaVersion as number) > SYNC_SCHEMA_VERSION)
    throw new Error(
      "Die Remote-Datei stammt von einer neueren l8db-Version. Bitte l8db aktualisieren.",
    );
  if (isEncryptedDocument(value)) return value;
  return parseDocumentValue(value);
}

export function parseDocument(source: string): SyncDocument {
  const value = parseEnvelope(source);
  if (isEncryptedDocument(value))
    throw new Error("Die Sync-Daten sind verschlüsselt und müssen zuerst entschlüsselt werden.");
  return value;
}

function parseDocumentValue(value: Record<string, unknown>): SyncDocument {
  if (!isRecord(value.items) || !isRecord(value.tombstones) || !str(value.deviceId))
    throw new Error("Die Remote-Datei ist beschädigt.");
  const items: SyncDocument["items"] = {};
  const tombstones: SyncDocument["tombstones"] = {};
  const known = new Set<string>(SYNC_COLLECTIONS);
  const extraItems = Object.fromEntries(
    Object.entries(value.items).filter(([collection]) => !known.has(collection)),
  );
  const extraTombstones = Object.fromEntries(
    Object.entries(value.tombstones).filter(([collection]) => !known.has(collection)),
  );
  const extra =
    Object.keys(extraItems).length + Object.keys(extraTombstones).length > 0
      ? { items: extraItems, tombstones: extraTombstones }
      : undefined;
  for (const collection of SYNC_COLLECTIONS) {
    const bucket = value.items[collection];
    if (isRecord(bucket)) {
      const clean: Record<string, DocumentItem> = {};
      for (const [id, entry] of Object.entries(bucket)) {
        if (!isRecord(entry) || !num(entry.updatedAt) || !isRecord(entry.data)) continue;
        if (!ITEM_CHECKS[collection](entry.data, id)) continue;
        const data = sanitizeData(collection, entry.data);
        clean[id] = {
          updatedAt: entry.updatedAt as number,
          data,
          ...(data === entry.data && typeof entry.h === "string" && HASH_PATTERN.test(entry.h)
            ? { h: entry.h }
            : {}),
        };
      }
      items[collection] = clean;
    }
    const deleted = value.tombstones[collection];
    if (isRecord(deleted)) {
      const clean: Record<string, number> = {};
      for (const [id, at] of Object.entries(deleted)) if (num(at)) clean[id] = at as number;
      tombstones[collection] = clean;
    }
  }
  return {
    format: SYNC_FORMAT,
    schemaVersion: value.schemaVersion as number,
    deviceId: value.deviceId as string,
    updatedAt: num(value.updatedAt) ? (value.updatedAt as number) : 0,
    contentHash: str(value.contentHash) ? (value.contentHash as string) : "",
    items,
    tombstones,
    secrets: str(value.secrets) ? (value.secrets as string) : null,
    secretsFingerprint: str(value.secretsFingerprint) ? (value.secretsFingerprint as string) : null,
    hints: {
      devicePaths:
        isRecord(value.hints) && Array.isArray(value.hints.devicePaths)
          ? (value.hints.devicePaths as DevicePathHint[]).filter(
              (hint) => isRecord(hint) && str(hint.id) && str(hint.field),
            )
          : [],
    },
    ...(extra ? { extra } : {}),
  };
}

export function documentSnapshot(document: SyncDocument): SyncSnapshot {
  const snapshot = emptySnapshot();
  for (const collection of SYNC_COLLECTIONS) {
    for (const [id, entry] of Object.entries(document.items[collection] ?? {}))
      snapshot.items.set(itemKey(collection, id), {
        hash: entry.h ?? hashData(entry.data),
        updatedAt: entry.updatedAt,
        data: entry.data,
      });
    for (const [id, deletedAt] of Object.entries(document.tombstones[collection] ?? {})) {
      const key = itemKey(collection, id);
      if (!snapshot.items.has(key)) snapshot.tombstones.set(key, deletedAt);
    }
  }
  return snapshot;
}

export function snapshotCollections(snapshot: SyncSnapshot): LocalCollections {
  const collections = Object.fromEntries(
    SYNC_COLLECTIONS.map((collection) => [collection, [] as LocalItem[]]),
  ) as LocalCollections;
  for (const [key, entry] of snapshot.items) {
    const { collection, id } = splitKey(key);
    collections[collection]?.push({ id, data: entry.data, updatedAt: entry.updatedAt });
  }
  return collections;
}

export interface CollectionChange {
  added: number;
  updated: number;
  removed: number;
}

export type ChangeSummary = Record<SyncCollection, CollectionChange>;

export function emptySummary(): ChangeSummary {
  return Object.fromEntries(
    SYNC_COLLECTIONS.map((collection) => [collection, { added: 0, updated: 0, removed: 0 }]),
  ) as ChangeSummary;
}

export function diffSnapshots(from: SyncSnapshot, to: SyncSnapshot): ChangeSummary {
  const summary = emptySummary();
  for (const [key, entry] of to.items) {
    const before = from.items.get(key);
    const { collection } = splitKey(key);
    if (!before) summary[collection].added++;
    else if (before.hash !== entry.hash) summary[collection].updated++;
  }
  for (const key of from.items.keys()) {
    if (!to.items.has(key)) summary[splitKey(key).collection].removed++;
  }
  return summary;
}

export function summaryTotal(summary: ChangeSummary): number {
  return SYNC_COLLECTIONS.reduce(
    (total, collection) =>
      total + summary[collection].added + summary[collection].updated + summary[collection].removed,
    0,
  );
}
