import { listCompareObjects } from "@/lib/compare-definition";
import { type CompareSideSelection, supportedCompareObjectTypes } from "@/lib/compare-types";
import type { SavedConnection } from "@/lib/connections";
import { executeQuery } from "@/lib/db";
import { effectiveConnectionString } from "@/lib/ssh";
import { captureObject } from "./capture";
import {
  FINGERPRINT_VERSION,
  fingerprintKey,
  loadFingerprints,
  type ObjectFingerprint,
} from "./fingerprint";
import { IGNORE_PATH, ignoreMatcher, parseIgnore } from "./ignore";
import { PROJECT_PATH } from "./model";
import { oracleIdentityMetadataSql } from "./oracle-metadata";
import {
  deleteFile,
  encode,
  readDriftCache,
  readFile,
  readFiles,
  saveFile,
  writeDriftCache,
} from "./repository";
import { METADATA_QUERY } from "./session";
import { newManagedObject, sourceFiles } from "./sources";
import type { ManagedObject, VersioningProject } from "./types";

export type DriftStatus = "changed" | "added" | "removed";

export interface DriftEntry {
  object: ManagedObject;
  status: DriftStatus;
  repository: Record<string, string | null>;
  database: Record<string, string> | null;
  fingerprint?: { scope: string; value: string };
}

export interface DriftProgress {
  done: number;
  total: number;
  captured: number;
  reused: number;
  ignored: number;
}

export interface DriftScanOptions {
  signal?: AbortSignal;
  full?: boolean;
  concurrency?: number;
  progress?: (progress: DriftProgress) => void;
}

interface DriftCache {
  format: 1;
  scopes: Record<string, { at: number; objects: Record<string, [string, string]> }>;
}

export const DRIFT_CONCURRENCY = 4;
export const DRIFT_OBJECT_LIMIT = 5000;
const CACHE_SCOPES = 8;
const MEMO_CHARS = 8_000_000;
const PROGRESS_INTERVAL = 100;

const memo = new Map<string, { fingerprint: string; definition: string }>();
let memoChars = 0;

export function clearDriftMemo() {
  memo.clear();
  memoChars = 0;
}

export const driftMemoSize = () => ({ entries: memo.size, chars: memoChars });

function remember(key: string, fingerprint: string, definition: string) {
  const previous = memo.get(key);
  if (previous) {
    memoChars -= previous.definition.length;
    memo.delete(key);
  }
  memo.set(key, { fingerprint, definition });
  memoChars += definition.length;
  for (const [oldest, value] of memo) {
    if (memoChars <= MEMO_CHARS) break;
    memo.delete(oldest);
    memoChars -= value.definition.length;
  }
}

export function textHash(value: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${(h2 >>> 0).toString(16).padStart(8, "0")}${(h1 >>> 0).toString(16).padStart(8, "0")}`;
}

const identity = (
  schema: string | null | undefined,
  type: string,
  name: string | null | undefined,
) => `${schema}\u0000${type}\u0000${name}`;

const joined = (files: Record<string, string | null> | null) =>
  Object.values(files ?? {})
    .filter((value) => value !== null)
    .join("\n");

export const repositoryText = (entry: DriftEntry) => joined(entry.repository);
export const databaseText = (entry: DriftEntry) => joined(entry.database);

const objectFiles = (object: ManagedObject) => [
  object.path,
  ...(object.bodyPath ? [object.bodyPath] : []),
];

const filesHash = (files: Record<string, string | null>) =>
  textHash(
    Object.entries(files)
      .map(([path, text]) => `${path}\u0000${text ?? "\u0001"}`)
      .join("\u0002"),
  );

export const driftScope = (
  project: VersioningProject,
  connection: SavedConnection,
  source: CompareSideSelection,
) =>
  [FINGERPRINT_VERSION, project.id, connection.id, source.database ?? "", source.schema ?? ""].join(
    "\u0000",
  );

function parseCache(text: string | null): DriftCache {
  if (!text) return { format: 1, scopes: {} };
  try {
    const value = JSON.parse(text) as DriftCache;
    if (value.format === 1 && value.scopes && typeof value.scopes === "object") return value;
  } catch {}
  return { format: 1, scopes: {} };
}

async function storeCache(
  repo: string,
  update: (cache: DriftCache) => boolean,
  current?: DriftCache,
): Promise<void> {
  try {
    const cache = current ?? parseCache(await readDriftCache(repo));
    if (!update(cache)) return;
    const scopes = Object.entries(cache.scopes)
      .sort(([, a], [, b]) => b.at - a.at)
      .slice(0, CACHE_SCOPES);
    await writeDriftCache(repo, JSON.stringify({ format: 1, scopes: Object.fromEntries(scopes) }));
  } catch {}
}

interface Candidate {
  object: ManagedObject;
  known: boolean;
  oid: string | null;
  key: string;
  fingerprint: ObjectFingerprint | undefined;
}

export async function scanDrift(
  repo: string,
  project: VersioningProject,
  connection: SavedConnection,
  source: CompareSideSelection,
  options: DriftScanOptions = {},
): Promise<DriftEntry[]> {
  const { signal } = options;
  const schema = source.schema;
  if (!schema) throw new Error("Ein Schema der Entwicklungsdatenbank auswählen.");
  const scope = driftScope(project, connection, source);
  const types = supportedCompareObjectTypes(connection);
  const [identityRows, fingerprints, cacheText, listings, ignoreText] = await Promise.all([
    connection.kind === "oracle"
      ? executeQuery(
          connection.kind,
          effectiveConnectionString(connection),
          oracleIdentityMetadataSql(schema),
          source.database ?? undefined,
          METADATA_QUERY,
        ).then((result) => result.rows)
      : Promise.resolve([]),
    loadFingerprints(connection, source.database, schema, types, signal),
    readDriftCache(repo).catch(() => null),
    Promise.all(
      types.map(async (objectType) => ({
        objectType,
        listed: await listCompareObjects(connection, { ...source, objectType }),
      })),
    ),
    readFile(repo, IGNORE_PATH),
  ]);
  const ignored = ignoreMatcher(
    (() => {
      try {
        return parseIgnore(ignoreText);
      } catch {
        return { format: 1 as const, patterns: [] };
      }
    })(),
  );
  signal?.throwIfAborted();
  const identitySequences = new Set(identityRows.map((row) => String(row.sequence)));
  const cache = parseCache(cacheText);
  const previous = options.full ? {} : (cache.scopes[scope]?.objects ?? {});
  const candidates: Candidate[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  const managedObjects = new Map(
    project.objects.map((object) => [
      identity(object.selection.schema, object.selection.objectType, object.selection.objectName),
      object,
    ]),
  );
  for (const { objectType, listed } of listings)
    for (const item of listed) {
      if (item.name.toUpperCase().startsWith("L8DB_VERSIONING_")) continue;
      const managed = managedObjects.get(identity(schema, objectType, item.name));
      if (objectType === "sequence" && identitySequences.has(item.name) && !managed) continue;
      if (!managed && ignored(objectType, item.name)) {
        skipped++;
        continue;
      }
      if (seen.size >= DRIFT_OBJECT_LIMIT)
        throw new Error(
          `Mehr als ${DRIFT_OBJECT_LIMIT} Objekte. Bitte ein kleineres Schema wählen.`,
        );
      const object =
        managed ??
        newManagedObject({ ...source, objectType, objectName: item.name, objectOid: item.oid });
      seen.add(object.id);
      const key = fingerprintKey(connection.kind, objectType, item.name);
      candidates.push({
        object,
        known: Boolean(managed),
        oid: item.oid,
        key,
        fingerprint: fingerprints?.get(key),
      });
    }
  const removed = project.objects.filter(
    (object) => object.selection.schema === schema && !seen.has(object.id),
  );
  const repoFiles = await readFiles(repo, [
    ...new Set(
      [
        ...candidates.filter((entry) => entry.known).map((entry) => entry.object),
        ...removed,
      ].flatMap(objectFiles),
    ),
  ]);
  signal?.throwIfAborted();
  const repositoryOf = (object: ManagedObject, known: boolean) =>
    Object.fromEntries(
      objectFiles(object).map((file) => [file, known ? (repoFiles[file] ?? null) : null]),
    );
  const next: Record<string, [string, string]> = {};
  const results: (DriftEntry | null)[] = new Array(candidates.length).fill(null);
  const pending: number[] = [];
  let reused = 0;
  candidates.forEach((candidate, index) => {
    const { fingerprint, object, known } = candidate;
    if (!known || !fingerprint || fingerprint.fresh) {
      pending.push(index);
      return;
    }
    const value = textHash(fingerprint.value);
    const stored = previous[object.id];
    const repository = repositoryOf(object, true);
    if (stored && stored[0] === value && stored[1] === filesHash(repository)) {
      next[object.id] = stored;
      reused++;
    } else pending.push(index);
  });
  const total = candidates.length;
  let captured = 0;
  let reported = 0;
  const report = (force = false) => {
    if (!options.progress) return;
    const now = Date.now();
    if (!force && now - reported < PROGRESS_INTERVAL) return;
    reported = now;
    options.progress({ done: reused + captured, total, captured, reused, ignored: skipped });
  };
  report(true);
  let cursor = 0;
  let failure: unknown = null;
  const work = async () => {
    while (cursor < pending.length && failure === null) {
      signal?.throwIfAborted();
      const index = pending[cursor++];
      const { object, known, oid, key, fingerprint } = candidates[index];
      const value = fingerprint && !fingerprint.fresh ? textHash(fingerprint.value) : null;
      const memoKey = `${scope}\u0000${key}`;
      const memoized = value && !options.full ? memo.get(memoKey) : undefined;
      const definition =
        memoized && memoized.fingerprint === value
          ? memoized.definition
          : (await captureObject(connection, source.database, object, null, undefined, oid))
              .definition;
      if (value) remember(memoKey, value, definition);
      signal?.throwIfAborted();
      const database = sourceFiles({ object, definition, checksum: "" });
      const repository = repositoryOf(object, known);
      const tag = value ? { fingerprint: { scope, value } } : {};
      if (!known) results[index] = { object, status: "added", repository, database, ...tag };
      else if (Object.entries(database).some(([file, text]) => repository[file] !== text))
        results[index] = { object, status: "changed", repository, database, ...tag };
      else if (value) next[object.id] = [value, filesHash(repository)];
      captured++;
      report();
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.max(1, Math.min(options.concurrency ?? DRIFT_CONCURRENCY, pending.length)) },
      () =>
        work().catch((error) => {
          if (failure === null) failure = error;
        }),
    ),
  );
  if (failure !== null) throw failure;
  report(true);
  const entries = results.filter((entry): entry is DriftEntry => entry !== null);
  for (const object of removed)
    entries.push({
      object,
      status: "removed",
      repository: repositoryOf(object, true),
      database: null,
    });
  const before = cache.scopes[scope]?.objects ?? {};
  const changed =
    Object.keys(before).length !== Object.keys(next).length ||
    Object.entries(next).some(([id, value]) => before[id]?.join() !== value.join());
  if (changed)
    await storeCache(
      repo,
      (current) => {
        current.scopes[scope] = { at: Date.now(), objects: next };
        return true;
      },
      cache,
    );
  return entries;
}

export async function recheckDrift(
  connection: SavedConnection,
  source: CompareSideSelection,
  entries: DriftEntry[],
): Promise<string[]> {
  const stale: string[] = [];
  let cursor = 0;
  const work = async () => {
    while (cursor < entries.length) {
      const entry = entries[cursor++];
      let definition: string | null = null;
      try {
        definition = (await captureObject(connection, source.database, entry.object)).definition;
      } catch {
        definition = null;
      }
      const current =
        definition === null
          ? null
          : sourceFiles({ object: entry.object, definition, checksum: "" });
      const same =
        current === null
          ? entry.database === null
          : entry.database !== null &&
            Object.keys(current).length === Object.keys(entry.database).length &&
            Object.entries(current).every(([file, text]) => entry.database?.[file] === text);
      if (!same) stale.push(entry.object.id);
    }
  };
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(DRIFT_CONCURRENCY, entries.length)) }, work),
  );
  return stale;
}

async function rememberSaved(repo: string, entries: DriftEntry[]) {
  const updates = entries.filter((entry) => entry.fingerprint || entry.status === "removed");
  if (!updates.length) return;
  await storeCache(repo, (cache) => {
    let touched = false;
    for (const entry of updates) {
      for (const scope of Object.values(cache.scopes)) {
        if (entry.status === "removed" && scope.objects[entry.object.id]) {
          delete scope.objects[entry.object.id];
          touched = true;
        }
      }
      if (!entry.fingerprint || !entry.database) continue;
      const target = cache.scopes[entry.fingerprint.scope] ?? { at: Date.now(), objects: {} };
      target.objects[entry.object.id] = [entry.fingerprint.value, filesHash(entry.database)];
      cache.scopes[entry.fingerprint.scope] = target;
      touched = true;
    }
    return touched;
  });
}

export async function saveDrift(
  repo: string,
  project: VersioningProject,
  projectText: string | null,
  entries: DriftEntry[],
): Promise<void> {
  if ((await readFile(repo, PROJECT_PATH)) !== projectText)
    throw new Error("Projektdatei wurde inzwischen geändert. Bitte erneut vergleichen.");
  for (const entry of entries) {
    if (entry.database) {
      for (const [file, text] of Object.entries(entry.database))
        await saveFile(repo, file, text, entry.repository[file] ?? null);
      continue;
    }
    for (const [file, text] of Object.entries(entry.repository))
      if (text !== null) await deleteFile(repo, file, text);
  }
  const removed = new Set(
    entries.filter((entry) => entry.status === "removed").map((entry) => entry.object.id),
  );
  const added = entries.filter((entry) => entry.status === "added").map((entry) => entry.object);
  if (removed.size || added.length)
    await saveFile(
      repo,
      PROJECT_PATH,
      encode({
        ...project,
        objects: [...project.objects.filter((object) => !removed.has(object.id)), ...added],
      }),
      projectText,
    );
  await rememberSaved(repo, entries);
}
