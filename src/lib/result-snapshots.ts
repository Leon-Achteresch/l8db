import type { QueryResult } from "@/lib/db";
import type { ResultRun } from "@/lib/result-compare";
import { syncAcrossWindows } from "@/lib/window-sync";

export const SNAPSHOT_MAX_COUNT = 10;
export const SNAPSHOT_MAX_CHARS = 500_000;
export const SNAPSHOT_TOTAL_CHARS = 2_000_000;
export const SNAPSHOT_MAX_ROWS = 999;
const STORE = "snapshots";
const REVISION_KEY = "l8db.result-snapshots.revision";
const listeners = new Set<() => void>();

function publish() {
  for (const listener of listeners) listener();
}

function changed() {
  publish();
  try {
    window.localStorage.setItem(REVISION_KEY, crypto.randomUUID());
  } catch {
    return;
  }
}

syncAcrossWindows(REVISION_KEY, publish);

export function subscribeResultSnapshots(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export interface ResultSnapshot {
  id: string;
  name: string;
  connectionId: string;
  database: string | null;
  at: number;
  savedAt: number;
  payload: string;
}

export function encodeSnapshot(run: ResultRun): string {
  if (run.result.truncated || run.result.rows.length > SNAPSHOT_MAX_ROWS)
    throw new Error(
      "Das Ergebnis wurde vom 1.000-Zeilen-Limit gekürzt. Für einen Ergebnisstand die Abfrage bitte mit LIMIT auf höchstens 999 Zeilen begrenzen.",
    );
  if (run.result.columns.length > 200)
    throw new Error("Ergebnisstände unterstützen höchstens 200 Spalten.");
  if (
    run.sql.length > SNAPSHOT_MAX_CHARS ||
    run.result.columns.reduce((sum, name) => sum + name.length, 0) > SNAPSHOT_MAX_CHARS
  )
    throw new Error("Der Ergebnisstand ist zu groß (maximal 500.000 Zeichen).");
  let chars = 0;
  let nodes = 0;
  const copy = (value: unknown, depth = 0): unknown => {
    if (++nodes > 50_000 || depth > 12)
      throw new Error("Das Ergebnis ist zu komplex für einen Ergebnisstand.");
    if (typeof value === "string") chars += value.length;
    if (chars > SNAPSHOT_MAX_CHARS)
      throw new Error("Der Ergebnisstand ist zu groß (maximal 500.000 Zeichen).");
    if (value === null || value === undefined) return null;
    if (typeof value === "object") {
      if (Array.isArray(value)) {
        const items: unknown[] = [];
        for (const item of value) items.push(copy(item, depth + 1));
        return items;
      }
      const entries: [string, unknown][] = [];
      for (const key in value) {
        if (!Object.hasOwn(value, key)) continue;
        chars += key.length;
        entries.push([key, copy((value as Record<string, unknown>)[key], depth + 1)]);
      }
      return Object.fromEntries(entries);
    }
    return value;
  };
  const result: QueryResult = {
    columns: run.result.columns,
    rows_affected: run.result.rows_affected,
    execution_time_ms: run.result.execution_time_ms,
    truncated: run.result.truncated,
    rows: run.result.rows.map((row) =>
      Object.fromEntries(
        run.result.columns.map((column) => {
          chars += column.length;
          return [column, copy(row[column])];
        }),
      ),
    ),
  };
  const payload = JSON.stringify({ sql: run.sql, result });
  if (payload.length > SNAPSHOT_MAX_CHARS)
    throw new Error("Der Ergebnisstand ist zu groß (maximal 500.000 Zeichen).");
  return payload;
}

export function snapshotRun(snapshot: ResultSnapshot): ResultRun {
  const { result, sql } = JSON.parse(snapshot.payload) as { result: QueryResult; sql: string };
  return {
    result,
    sql,
    at: snapshot.at,
    connectionId: snapshot.connectionId,
    database: snapshot.database,
  };
}

async function transact<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore, done: (value: T) => void, fail: (error: Error) => void) => void,
): Promise<T> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("l8db.result-snapshots", 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    let value: T;
    tx.oncomplete = () => {
      db.close();
      resolve(value);
    };
    tx.onabort = tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("Ergebnisstände konnten nicht gespeichert werden."));
    };
    action(
      tx.objectStore(STORE),
      (next) => {
        value = next;
      },
      (error) => {
        tx.abort();
        reject(error);
      },
    );
  });
}

export function listResultSnapshots(): Promise<ResultSnapshot[]> {
  return transact("readonly", (store, done) => {
    const request = store.getAll();
    request.onsuccess = () =>
      done((request.result as ResultSnapshot[]).sort((a, b) => b.savedAt - a.savedAt));
  });
}

export async function saveResultSnapshot(name: string, run: ResultRun): Promise<ResultSnapshot> {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 80)
    throw new Error("Bitte einen Namen mit 1 bis 80 Zeichen eingeben.");
  const snapshot: ResultSnapshot = {
    id: crypto.randomUUID(),
    name: trimmed,
    connectionId: run.connectionId,
    database: run.database,
    at: run.at,
    savedAt: Date.now(),
    payload: encodeSnapshot(run),
  };
  const saved = await transact<ResultSnapshot>("readwrite", (store, done, fail) => {
    const request = store.getAll();
    request.onsuccess = () => {
      const saved = request.result as ResultSnapshot[];
      if (
        saved.length >= SNAPSHOT_MAX_COUNT ||
        saved.reduce((sum, item) => sum + item.payload.length, snapshot.payload.length) >
          SNAPSHOT_TOTAL_CHARS
      ) {
        fail(
          new Error(
            "Speicher voll: höchstens 10 Ergebnisstände und insgesamt 2 Millionen Zeichen. Lösche zuerst einen Stand.",
          ),
        );
        return;
      }
      store.put(snapshot);
      done(snapshot);
    };
  });
  changed();
  return saved;
}

export async function deleteResultSnapshot(id: string): Promise<void> {
  await transact<void>("readwrite", (store, done) => {
    store.delete(id);
    done(undefined);
  });
  changed();
}
