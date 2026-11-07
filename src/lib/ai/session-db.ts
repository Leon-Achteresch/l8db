import type { AiSession } from "@/lib/ai/store";

const DATABASE = "l8db.ai";
const STORE = "sessions";
let opening: Promise<IDBDatabase> | undefined;

function openDatabase(): Promise<IDBDatabase> {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => {
        database.close();
        opening = undefined;
      };
      resolve(database);
    };
    request.onerror = () => reject(request.error);
  });
  opening.catch(() => {
    opening = undefined;
  });
  return opening;
}

function finished(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    let failure: unknown;
    transaction.oncomplete = () => resolve();
    transaction.onerror = (event) => {
      failure = (event.target as IDBRequest | null)?.error ?? transaction.error;
    };
    transaction.onabort = () =>
      reject(failure ?? transaction.error ?? new Error("AI-Speichern abgebrochen"));
  });
}

export async function readAiSessions(ids?: string[]): Promise<AiSession[]> {
  const database = await openDatabase();
  const transaction = database.transaction(STORE, "readonly");
  const store = transaction.objectStore(STORE);
  const sessions: AiSession[] = [];
  if (ids)
    for (const id of ids) {
      const request = store.get(id);
      request.onsuccess = () => {
        if (request.result) sessions.push(request.result);
      };
    }
  else {
    const request = store.getAll();
    request.onsuccess = () => sessions.push(...request.result);
  }
  await finished(transaction);
  return sessions;
}

function writeSession(database: IDBDatabase, session: AiSession): Promise<void> {
  const transaction = database.transaction(STORE, "readwrite");
  const store = transaction.objectStore(STORE);
  const request = store.get(session.id);
  request.onsuccess = () => {
    if ((request.result?.updatedAt ?? -1) >= session.updatedAt) return;
    try {
      store.put(session);
    } catch {
      transaction.abort();
    }
  };
  return finished(transaction);
}

export async function writeAiSessions(sessions: AiSession[]): Promise<string[]> {
  if (!sessions.length) return [];
  const database = await openDatabase();
  const results = await Promise.allSettled(
    sessions.map((session) => writeSession(database, session)),
  );
  return sessions
    .filter((_, index) => results[index].status === "rejected")
    .map((session) => session.id);
}
