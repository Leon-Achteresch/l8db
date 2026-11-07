import { syncAcrossWindows } from "@/lib/window-sync";

export type RecordKind = "checkpoint" | "success" | "parameters" | "investigation" | "watch";
export interface WorkbenchRecord<T = unknown> {
  id: string;
  kind: RecordKind;
  scope: string;
  name: string;
  at: number;
  value: T;
  chars: number;
}
export const RECORD_LIMITS = {
  checkpoint: [100, 4_000_000],
  success: [100, 2_000_000],
  parameters: [100, 1_000_000],
  investigation: [30, 4_000_000],
  watch: [200, 2_000_000],
} as const;
export const RECORD_MAX_CHARS = 500_000;
const REVISION = "l8db.workbench.revision";
interface RecordChange {
  kind: RecordKind;
  scope: string;
}
const listeners = new Set<(change?: RecordChange) => void>();

export function subscribeWorkbench(listener: (change?: RecordChange) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
function publish(change?: RecordChange) {
  for (const listener of listeners) listener(change);
}
syncAcrossWindows(REVISION, (value) => {
  try {
    const change = JSON.parse(value ?? "null") as RecordChange | null;
    publish(change ?? undefined);
  } catch {
    publish();
  }
});
function changed(change?: RecordChange) {
  publish(change);
  try {
    window.localStorage.setItem(
      REVISION,
      JSON.stringify({ ...change, revision: crypto.randomUUID() }),
    );
  } catch {
    return;
  }
}
export function workbenchScope(connectionId: string, database: string | null) {
  return JSON.stringify([connectionId, database]);
}
async function transaction<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore, done: (value: T) => void, fail: (error: Error) => void) => void,
): Promise<T> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("l8db.workbench", 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore("records", { keyPath: "id" });
      store.createIndex("kind", "kind");
      store.createIndex("scope", ["kind", "scope"]);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return new Promise<T>((resolve, reject) => {
    let result: T;
    let failure: Error | undefined;
    const tx = db.transaction("records", mode);
    tx.oncomplete = () => {
      db.close();
      resolve(result);
    };
    tx.onabort = tx.onerror = () => {
      db.close();
      reject(failure ?? tx.error ?? new Error("Arbeitsstand konnte nicht gespeichert werden."));
    };
    try {
      action(
        tx.objectStore("records"),
        (value) => {
          result = value;
        },
        (error) => {
          failure = error;
          tx.abort();
        },
      );
    } catch (error) {
      failure = error instanceof Error ? error : new Error(String(error));
      tx.abort();
    }
  });
}
export function listWorkbenchRecords<T>(
  kind: RecordKind,
  scope?: string,
): Promise<WorkbenchRecord<T>[]> {
  return transaction("readonly", (store, done) => {
    const request =
      scope === undefined
        ? store.index("kind").getAll(kind)
        : store.index("scope").getAll([kind, scope]);
    request.onsuccess = () =>
      done((request.result as WorkbenchRecord<T>[]).sort((a, b) => b.at - a.at));
  });
}
export async function saveWorkbenchRecord<T>(
  input: { id?: string; kind: RecordKind; scope: string; name: string; value: T },
  evictOldest = false,
): Promise<WorkbenchRecord<T>> {
  const name = input.name.trim();
  if (!name || name.length > 80)
    throw new Error("Bitte einen Namen mit 1 bis 80 Zeichen eingeben.");
  if (input.scope.length > RECORD_MAX_CHARS) throw new Error("Der Gültigkeitsbereich ist zu groß.");
  let nodes = 0;
  let textChars = 0;
  const payload = JSON.stringify(input.value, (key, value: unknown) => {
    textChars += key.length + (typeof value === "string" ? value.length : 0);
    if (++nodes > 100_000 || textChars > RECORD_MAX_CHARS)
      throw new Error("Dieser Stand ist zu groß oder zu komplex.");
    return value;
  });
  if (payload === undefined) throw new Error("Der Stand enthält keine speicherbaren Daten.");
  const id = input.id ?? crypto.randomUUID();
  const chars = payload.length + input.scope.length + name.length + id.length;
  if (chars > RECORD_MAX_CHARS)
    throw new Error("Dieser Stand ist zu groß (maximal 500.000 Zeichen).");
  const record = {
    ...input,
    id,
    name,
    at: Date.now(),
    value: JSON.parse(payload) as T,
    chars,
  };
  await transaction<void>("readwrite", (store, done, fail) => {
    const request = store.index("kind").getAll(input.kind);
    request.onsuccess = () => {
      const others = (request.result as WorkbenchRecord[])
        .filter((entry) => entry.id !== record.id)
        .sort((a, b) => a.at - b.at);
      const [maxCount, maxChars] = RECORD_LIMITS[input.kind];
      let total = others.reduce((sum, entry) => sum + entry.chars, chars);
      while (evictOldest && others.length && (others.length >= maxCount || total > maxChars)) {
        const oldest = others.shift();
        if (!oldest) break;
        store.delete(oldest.id);
        total -= oldest.chars;
      }
      if (others.length >= maxCount || total > maxChars) {
        fail(
          new Error(
            `Speicher für diese Funktion voll. Höchstens ${maxCount} Einträge und ${maxChars.toLocaleString("de-DE")} Zeichen; bitte zuerst einen Eintrag löschen.`,
          ),
        );
        return;
      }
      store.put(record);
      done(undefined);
    };
  });
  changed(record);
  return record;
}
export async function deleteWorkbenchRecord(id: string): Promise<void> {
  await transaction<void>("readwrite", (store, done) => {
    store.delete(id);
    done(undefined);
  });
  changed();
}
