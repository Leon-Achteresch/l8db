import { reportStorageFailure } from "@/lib/buffered-storage";

const DATABASE = "l8db.storage";
const STORE = "entries";
export const STORAGE_CHANGED_KEY = "l8db.storage.changed";
export const STORAGE_MIGRATED_KEY = "l8db.storage.migrated";
export const STORAGE_FALLBACK_KEY = "l8db.storage.fallback";
export const STORAGE_BACKUP_PREFIX = "l8db.storage.backup:";
export const MIRRORED_KEYS = new Set(["l8db.connections", "l8db.settings"]);
const INTERNAL_KEYS = new Set([STORAGE_CHANGED_KEY, STORAGE_MIGRATED_KEY]);

export type StorageMode = "indexeddb" | "localstorage" | "failed";

const cache = new Map<string, string>();
const pending = new Map<string, string | null>();
const versions = new Map<string, number>();
const missed = new Set<string>();
let database: IDBDatabase | undefined;
let native: Storage | undefined;
let host: Window | undefined;
let frozen = false;
let scheduled = false;
let retrying = false;
let writes: Promise<void> = Promise.resolve();

function done(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error("Speichern abgebrochen"));
  });
}

function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function openDatabase(factory: IDBFactory, timeoutMs: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("IndexedDB antwortet nicht")), timeoutMs);
    const request = factory.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    result(request).then(
      (opened) => {
        clearTimeout(timer);
        resolve(opened);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function planMigration(
  stored: Map<string, string>,
  legacy: [string, string][],
  migrated: boolean,
): { puts: [string, string][]; removes: string[] } {
  const puts: [string, string][] = [];
  const removes: string[] = [];
  for (const [key, value] of legacy) {
    if (INTERNAL_KEYS.has(key)) continue;
    const current = stored.get(key);
    if (MIRRORED_KEYS.has(key)) {
      if (current !== value) puts.push([key, value]);
      continue;
    }
    if (!migrated || current === undefined) puts.push([key, value]);
    else if (current !== value) puts.push([`${STORAGE_BACKUP_PREFIX}${key}`, value]);
    removes.push(key);
  }
  return { puts, removes };
}

function mirror(key: string, value: string | null) {
  if (!native || !MIRRORED_KEYS.has(key)) return;
  try {
    if (value === null) native.removeItem(key);
    else native.setItem(key, value);
  } catch {
    native.removeItem(key);
  }
}

function announce(keys: string[], reload = false) {
  try {
    native?.setItem(
      STORAGE_CHANGED_KEY,
      JSON.stringify({ keys, reload, at: `${Date.now()}:${Math.random()}` }),
    );
  } catch {}
}

function flush() {
  scheduled = false;
  if (!database || pending.size === 0) return;
  const batch = new Map(pending);
  pending.clear();
  const failed = (error: unknown) => {
    if (retrying) {
      reportStorageFailure([...batch.keys()].join(", "), error);
      return;
    }
    retrying = true;
    for (const [key, value] of batch) if (!pending.has(key)) pending.set(key, value);
    setTimeout(flush, 1000);
  };
  let transaction: IDBTransaction;
  try {
    transaction = database.transaction(STORE, "readwrite");
    const store = transaction.objectStore(STORE);
    for (const [key, value] of batch) {
      if (value === null) store.delete(key);
      else store.put(value, key);
    }
  } catch (error) {
    failed(error);
    return;
  }
  const committed = done(transaction).then(() => {
    retrying = false;
    announce([...batch.keys()]);
  }, failed);
  writes = writes.then(() => committed);
  transaction.commit?.();
}

function schedule() {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(flush);
}

function write(key: string, value: string | null) {
  if (frozen) return;
  if (value === null) {
    if (!cache.delete(key)) return;
  } else {
    if (cache.get(key) === value) return;
    cache.set(key, value);
  }
  versions.set(key, (versions.get(key) ?? 0) + 1);
  mirror(key, value);
  pending.set(key, value);
  schedule();
}

export const appStorage: Storage = {
  get length() {
    return cache.size;
  },
  key: (index) => [...cache.keys()][index] ?? null,
  getItem: (key) => cache.get(key) ?? null,
  setItem: (key, value) => write(key, String(value)),
  removeItem: (key) => write(key, null),
  clear: () => {
    for (const key of [...cache.keys()]) write(key, null);
  },
};

function adopt(key: string, next: string | null) {
  const previous = cache.get(key) ?? null;
  if (next === previous) return;
  if (next === null) cache.delete(key);
  else cache.set(key, next);
  host?.dispatchEvent(
    new StorageEvent("storage", {
      key,
      oldValue: previous,
      newValue: next,
      url: host.location.href,
    }),
  );
}

async function readRemote(keys: string[]) {
  if (!database || frozen) return;
  const before = keys.map((key) => versions.get(key) ?? 0);
  const store = database.transaction(STORE, "readonly").objectStore(STORE);
  const values = await Promise.all(keys.map((key) => result(store.get(key))));
  keys.forEach((key, index) => {
    if (frozen || pending.has(key) || (versions.get(key) ?? 0) !== before[index]) return;
    adopt(key, typeof values[index] === "string" ? (values[index] as string) : null);
  });
}

function onStorage(event: StorageEvent) {
  if (event.key && MIRRORED_KEYS.has(event.key)) {
    if (database && !frozen && !pending.has(event.key)) adopt(event.key, event.newValue);
    return;
  }
  if (event.key !== STORAGE_CHANGED_KEY || !event.newValue) return;
  let change: { keys: string[]; reload?: boolean };
  try {
    change = JSON.parse(event.newValue);
  } catch {
    return;
  }
  if (change.reload && database) {
    frozen = true;
    host?.location.reload();
    return;
  }
  if (!database) for (const key of change.keys) missed.add(key);
  else void readRemote(change.keys);
}

export function usesIndexedDb() {
  return database !== undefined;
}

export async function initAppStorage(
  target: Window = window,
  timeoutMs = 10_000,
): Promise<StorageMode> {
  if (database) return "indexeddb";
  native = target.localStorage;
  host = target;
  const migrated = native.getItem(STORAGE_MIGRATED_KEY) !== null;
  if (target.sessionStorage?.getItem(STORAGE_FALLBACK_KEY)) return "localstorage";
  target.addEventListener("storage", onStorage);
  try {
    const opened = await openDatabase(target.indexedDB, timeoutMs);
    const reading = opened.transaction(STORE, "readonly").objectStore(STORE);
    const [keys, values] = await Promise.all([
      result(reading.getAllKeys()),
      result(reading.getAll()),
    ]);
    keys.forEach((key, index) => {
      if (typeof values[index] === "string") cache.set(String(key), values[index]);
    });
    const legacy: [string, string][] = [];
    for (let index = 0; index < native.length; index++) {
      const key = native.key(index);
      const value = key === null ? null : native.getItem(key);
      if (key !== null && value !== null) legacy.push([key, value]);
    }
    const { puts, removes } = planMigration(cache, legacy, migrated);
    if (puts.length > 0) {
      const migration = opened.transaction(STORE, "readwrite");
      for (const [key, value] of puts) migration.objectStore(STORE).put(value, key);
      await done(migration);
      for (const [key, value] of puts) cache.set(key, value);
    }
    for (const key of removes) native.removeItem(key);
    for (const key of MIRRORED_KEYS) mirror(key, cache.get(key) ?? null);
    native.setItem(STORAGE_MIGRATED_KEY, "1");
    database = opened;
    target.addEventListener("pagehide", flush);
    Object.defineProperty(target, "localStorage", { configurable: true, value: appStorage });
    void target.navigator.storage?.persist?.().catch(() => undefined);
    if (missed.size > 0) void readRemote([...missed]);
    missed.clear();
    return "indexeddb";
  } catch (error) {
    console.warn("IndexedDB-Speicher nicht verfügbar.", error);
    cache.clear();
    target.removeEventListener("storage", onStorage);
    return migrated ? "failed" : "localstorage";
  }
}

export function flushAppStorage(timeoutMs = 2000): Promise<void> {
  flush();
  return Promise.race([writes, new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))]);
}

export async function commitStorageAndReload(changes: Record<string, string | null>) {
  for (const [key, value] of Object.entries(changes)) {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  }
  frozen = true;
  await flushAppStorage();
  announce(Object.keys(changes), true);
  window.location.reload();
}

export function storageEntries(): [string, string][] {
  if (database) return [...cache];
  const entries: [string, string][] = [];
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    const value = key === null ? null : localStorage.getItem(key);
    if (key !== null && value !== null && !INTERNAL_KEYS.has(key)) entries.push([key, value]);
  }
  return entries;
}
