import type { PersistStorage, StorageValue } from "zustand/middleware";

export function createBufferedJsonStorage<S>(
  getStorage: () => Pick<Storage, "getItem" | "setItem" | "removeItem">,
  delay = 250,
): PersistStorage<S> & { flush: () => void; dispose: () => void } {
  const pending = new Map<string, StorageValue<S>>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const flush = () => {
    clearTimeout(timer);
    timer = undefined;
    for (const [key, value] of pending) {
      getStorage().setItem(key, JSON.stringify(value));
      pending.delete(key);
    }
  };
  const flushInBackground = () => {
    try {
      flush();
    } catch (error) {
      console.error("Tabs konnten nicht gespeichert werden.", error);
    }
  };
  const onVisibility = () => {
    if (document.visibilityState === "hidden") flushInBackground();
  };
  if (typeof window !== "undefined") {
    window.addEventListener?.("pagehide", flushInBackground);
    window.addEventListener?.("beforeunload", flushInBackground);
  }
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);

  return {
    getItem: (key) => {
      const value = pending.get(key);
      if (value) return value;
      const stored = getStorage().getItem(key);
      return stored ? JSON.parse(stored) : null;
    },
    setItem: (key, value) => {
      pending.set(key, value);
      timer ??= setTimeout(flushInBackground, delay);
    },
    removeItem: (key) => {
      pending.delete(key);
      if (pending.size === 0) {
        clearTimeout(timer);
        timer = undefined;
      }
      return getStorage().removeItem(key);
    },
    flush,
    dispose: () => {
      flushInBackground();
      if (typeof window !== "undefined") {
        window.removeEventListener?.("pagehide", flushInBackground);
        window.removeEventListener?.("beforeunload", flushInBackground);
      }
      if (typeof document !== "undefined")
        document.removeEventListener("visibilitychange", onVisibility);
    },
  };
}
