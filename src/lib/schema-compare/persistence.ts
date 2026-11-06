import { reportStorageFailure } from "@/lib/buffered-storage";
import type { Tab } from "@/lib/table-tabs/types";
import type { CompareResult } from "./types";

const PREFIX = "l8db.schema-compare";
const DATABASE = "l8db.schema-compare";
const STORE = "results";

export const LEGACY_SCHEMA_COMPARE_ID = "default";

export function schemaCompareKey(id?: string): string {
  return !id || id === LEGACY_SCHEMA_COMPARE_ID ? PREFIX : `${PREFIX}:${id}`;
}

export function schemaCompareIds(lists: Iterable<readonly Tab[]>): Set<string> {
  const ids = new Set<string>();
  for (const tabs of lists)
    for (const tab of tabs)
      if (tab.kind === "tool" && tab.tool === "schema-compare" && tab.id) ids.add(tab.id);
  return ids;
}

function request(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest,
): Promise<unknown> {
  if (typeof indexedDB === "undefined") return Promise.resolve(undefined);
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DATABASE, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      try {
        const tx = db.transaction(STORE, mode);
        const pending = run(tx.objectStore(STORE));
        tx.oncomplete = () => {
          db.close();
          resolve(pending.result);
        };
        tx.onabort = tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      } catch (error) {
        db.close();
        reject(error);
      }
    };
  });
}

export function loadCompareResult(key: string): Promise<CompareResult | null> {
  return request("readonly", (store) => store.get(key))
    .then((value) => (value as CompareResult | undefined) ?? null)
    .catch(() => null);
}

export function saveCompareResult(key: string, result: CompareResult | null): Promise<void> {
  return request("readwrite", (store) => (result ? store.put(result, key) : store.delete(key)))
    .then(() => undefined)
    .catch((error) => reportStorageFailure(key, error));
}

export function forgetSchemaCompare(id: string): Promise<void> {
  const key = schemaCompareKey(id);
  try {
    window.localStorage.removeItem(key);
  } catch (error) {
    reportStorageFailure(key, error);
  }
  return saveCompareResult(key, null);
}
