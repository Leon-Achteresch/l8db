import {
  DELETED,
  hashData,
  itemKey,
  type SyncBase,
  type SyncCollection,
  type SyncEntry,
  type SyncSnapshot,
  splitKey,
} from "./payload";

export type ConflictStrategy = "local" | "remote" | "both";

export interface SyncConflict {
  key: string;
  collection: SyncCollection;
  id: string;
  label: string;
  local: SyncEntry | null;
  remote: SyncEntry | null;
  localDeletedAt: number | null;
  remoteDeletedAt: number | null;
}

export interface MergeResult {
  merged: SyncSnapshot;
  conflicts: SyncConflict[];
}

const DUPLICABLE = new Set<SyncCollection>([
  "connections",
  "savedQueries",
  "snippets",
  "hostGroupRules",
]);

function state(snapshot: SyncSnapshot, key: string): string | undefined {
  const entry = snapshot.items.get(key);
  if (entry) return entry.hash;
  return snapshot.tombstones.has(key) ? DELETED : undefined;
}

function label(collection: SyncCollection, id: string, entry: SyncEntry | null): string {
  const data = entry?.data as { name?: unknown } | undefined;
  return typeof data?.name === "string" && data.name ? data.name : `${collection} ${id}`;
}

function copy(target: SyncSnapshot, source: SyncSnapshot, key: string): void {
  const entry = source.items.get(key);
  if (entry) {
    target.items.set(key, entry);
    target.tombstones.delete(key);
    return;
  }
  const deletedAt = source.tombstones.get(key);
  target.items.delete(key);
  if (deletedAt !== undefined) target.tombstones.set(key, deletedAt);
  else target.tombstones.delete(key);
}

function stamp(snapshot: SyncSnapshot, key: string): number {
  return snapshot.items.get(key)?.updatedAt ?? snapshot.tombstones.get(key) ?? 0;
}

export function mergeSnapshots(
  local: SyncSnapshot,
  remote: SyncSnapshot,
  base: SyncBase,
): MergeResult {
  const merged: SyncSnapshot = { items: new Map(), tombstones: new Map() };
  const conflicts: SyncConflict[] = [];
  const keys = new Set<string>([
    ...local.items.keys(),
    ...local.tombstones.keys(),
    ...remote.items.keys(),
    ...remote.tombstones.keys(),
  ]);
  for (const key of keys) {
    const ours = state(local, key);
    const theirs = state(remote, key);
    if (ours === theirs) {
      if (ours === DELETED)
        merged.tombstones.set(
          key,
          Math.max(local.tombstones.get(key) ?? 0, remote.tombstones.get(key) ?? 0),
        );
      else {
        const left = local.items.get(key) as SyncEntry;
        const right = remote.items.get(key) as SyncEntry;
        merged.items.set(
          key,
          left.updatedAt >= right.updatedAt ? left : { ...left, updatedAt: right.updatedAt },
        );
      }
      continue;
    }
    const known = base.get(key)?.[0];
    const localChanged = ours !== known;
    const remoteChanged = theirs !== known;
    if (!remoteChanged || theirs === undefined) {
      copy(merged, local, key);
      continue;
    }
    if (!localChanged || ours === undefined) {
      copy(merged, remote, key);
      continue;
    }
    const { collection, id } = splitKey(key);
    const localEntry = local.items.get(key) ?? null;
    const remoteEntry = remote.items.get(key) ?? null;
    conflicts.push({
      key,
      collection,
      id,
      label: label(collection, id, localEntry ?? remoteEntry),
      local: localEntry,
      remote: remoteEntry,
      localDeletedAt: local.tombstones.get(key) ?? null,
      remoteDeletedAt: remote.tombstones.get(key) ?? null,
    });
    copy(merged, stamp(local, key) >= stamp(remote, key) ? local : remote, key);
  }
  return { merged, conflicts };
}

function duplicateId(id: string, entry: SyncEntry): string {
  return `${id}-remote-${entry.hash.replace(/[^a-z0-9]/gi, "").slice(0, 8)}`;
}

export function resolveConflicts(
  result: MergeResult,
  strategy: ConflictStrategy,
  now: number = Date.now(),
): SyncSnapshot {
  const merged: SyncSnapshot = {
    items: new Map(result.merged.items),
    tombstones: new Map(result.merged.tombstones),
  };
  const take = (key: string, entry: SyncEntry | null, deletedAt: number | null) => {
    if (entry) {
      merged.items.set(key, entry);
      merged.tombstones.delete(key);
    } else {
      merged.items.delete(key);
      merged.tombstones.set(key, deletedAt ?? now);
    }
  };
  for (const conflict of result.conflicts) {
    if (strategy === "local") {
      take(conflict.key, conflict.local, conflict.localDeletedAt);
      continue;
    }
    if (strategy === "remote") {
      take(conflict.key, conflict.remote, conflict.remoteDeletedAt);
      continue;
    }
    if (conflict.local && !conflict.remote) {
      take(conflict.key, conflict.local, null);
      continue;
    }
    if (conflict.remote && !conflict.local) {
      take(conflict.key, conflict.remote, null);
      continue;
    }
    if (!conflict.local || !conflict.remote) continue;
    if (!DUPLICABLE.has(conflict.collection)) {
      take(
        conflict.key,
        conflict.local.updatedAt >= conflict.remote.updatedAt ? conflict.local : conflict.remote,
        null,
      );
      continue;
    }
    take(conflict.key, conflict.local, null);
    const id = duplicateId(conflict.id, conflict.remote);
    const source = conflict.remote.data as Record<string, unknown>;
    const data = {
      ...source,
      id,
      name: `${typeof source.name === "string" ? source.name : conflict.id} (Remote)`,
    };
    merged.items.set(itemKey(conflict.collection, id), {
      hash: hashData(data),
      updatedAt: now,
      data,
    });
  }
  return merged;
}
