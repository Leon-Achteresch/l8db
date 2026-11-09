import { toast } from "sonner";
import {
  createJSONStorage,
  type PersistStorage,
  type StateStorage,
  type StorageValue,
} from "zustand/middleware";

type KeyValueStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

let storageFullNotified = false;

export function reportStorageFailure(key: string, error: unknown) {
  console.warn(`Speichern von ${key} fehlgeschlagen.`, error);
  if (
    storageFullNotified ||
    !(error instanceof DOMException && error.name === "QuotaExceededError")
  )
    return;
  storageFullNotified = true;
  toast.error("Lokaler Speicher ist voll", {
    description: "Einige Änderungen werden nicht dauerhaft gespeichert.",
    duration: 15_000,
    action: {
      label: "Speicher verwalten",
      onClick: () =>
        void import("@/router").then(({ router }) =>
          router.navigate({ to: "/settings", search: { tab: "storage" } }),
        ),
    },
  });
}

export function safeSetItem(storage: KeyValueStorage, key: string, value: string) {
  try {
    storage.setItem(key, value);
  } catch (error) {
    reportStorageFailure(key, error);
  }
}

export function createSafeJsonStorage<S>(): PersistStorage<S> | undefined {
  return createJSONStorage<S>(() => {
    const storage = window.localStorage;
    return {
      getItem: (key) => storage.getItem(key),
      setItem: (key, value) => safeSetItem(storage, key, value),
      removeItem: (key) => storage.removeItem(key),
    };
  });
}

export function createQuotaSafeStorage(listKey: string): StateStorage {
  return {
    getItem: (name) => window.localStorage.getItem(name),
    removeItem: (name) => window.localStorage.removeItem(name),
    setItem: (name, value) => {
      let payload = value;
      let parsed: StorageValue<Record<string, unknown>> | undefined;
      for (;;) {
        try {
          window.localStorage.setItem(name, payload);
          return;
        } catch (error) {
          if (error instanceof DOMException && error.name === "QuotaExceededError") {
            parsed ??= JSON.parse(payload) as StorageValue<Record<string, unknown>>;
            const list = parsed.state[listKey];
            if (Array.isArray(list) && list.length > 0) {
              parsed = {
                ...parsed,
                state: { ...parsed.state, [listKey]: list.slice(0, Math.floor(list.length / 2)) },
              };
              payload = JSON.stringify(parsed);
              continue;
            }
          }
          reportStorageFailure(name, error);
          return;
        }
      }
    },
  };
}

export function createChangedOnlyJsonStorage<S>(
  getStorage: () => KeyValueStorage = () => window.localStorage,
): PersistStorage<S> | undefined {
  return createJSONStorage<S>(() => {
    const storage = getStorage();
    return {
      getItem: (key) => storage.getItem(key),
      setItem: (key, value) => {
        if (storage.getItem(key) !== value) safeSetItem(storage, key, value);
      },
      removeItem: (key) => storage.removeItem(key),
    };
  });
}

export function createBufferedJsonStorage<S>(
  getStorage: () => KeyValueStorage,
  delay = 250,
): PersistStorage<S> & {
  flush: () => void;
  setNow: (key: string, value: StorageValue<S>) => void;
  dispose: () => void;
} {
  const pending = new Map<string, StorageValue<S>>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const flush = () => {
    clearTimeout(timer);
    timer = undefined;
    for (const [key, value] of pending) {
      const json = JSON.stringify(value);
      if (getStorage().getItem(key) !== json) getStorage().setItem(key, json);
      pending.delete(key);
    }
    unlisten();
  };
  const flushInBackground = () => {
    try {
      flush();
    } catch (error) {
      reportStorageFailure("Tabs und Arbeitsbereiche", error);
    }
  };
  const win = typeof window !== "undefined" ? window : undefined;
  const doc = typeof document !== "undefined" ? document : undefined;
  const onVisibility = () => {
    if (doc?.visibilityState === "hidden") flushInBackground();
  };
  let listening = false;
  function listen() {
    if (listening) return;
    listening = true;
    win?.addEventListener?.("pagehide", flushInBackground);
    win?.addEventListener?.("beforeunload", flushInBackground);
    doc?.addEventListener?.("visibilitychange", onVisibility);
  }
  function unlisten() {
    if (!listening) return;
    listening = false;
    win?.removeEventListener?.("pagehide", flushInBackground);
    win?.removeEventListener?.("beforeunload", flushInBackground);
    doc?.removeEventListener?.("visibilitychange", onVisibility);
  }

  return {
    getItem: (key) => {
      const value = pending.get(key);
      if (value) return value;
      const stored = getStorage().getItem(key);
      return stored ? JSON.parse(stored) : null;
    },
    setItem: (key, value) => {
      pending.set(key, value);
      listen();
      timer ??= setTimeout(flushInBackground, delay);
    },
    removeItem: (key) => {
      pending.delete(key);
      if (pending.size === 0) {
        clearTimeout(timer);
        timer = undefined;
        unlisten();
      }
      return getStorage().removeItem(key);
    },
    flush,
    setNow: (key, value) => {
      pending.set(key, value);
      flush();
    },
    dispose: () => {
      flushInBackground();
      unlisten();
    },
  };
}
