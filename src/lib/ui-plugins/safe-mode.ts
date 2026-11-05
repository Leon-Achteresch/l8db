const PREFIX = "l8db.ui-plugins.loading:";
const FLAG = "l8db.ui-plugins.safe-mode";
const SETTLE_MS = 10_000;
const STALE_MS = 60_000;

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function ownKey() {
  const search = typeof window === "undefined" ? "" : (window.location?.search ?? "");
  return `${PREFIX}${search || "main"}`;
}

export function detectUiPluginSafeMode(now = Date.now()): boolean {
  const store = storage();
  if (!store) return false;
  const own = ownKey();
  let hung = false;
  for (let index = store.length - 1; index >= 0; index--) {
    const key = store.key(index);
    if (!key?.startsWith(PREFIX)) continue;
    const started = Number(store.getItem(key));
    if (key === own || !Number.isFinite(started) || now - started > STALE_MS) {
      hung = true;
      store.removeItem(key);
    }
  }
  if (hung) store.setItem(FLAG, String(now));
  return hung || store.getItem(FLAG) !== null;
}

export function markUiPluginLoading(now = Date.now()): () => void {
  const store = storage();
  if (!store) return () => undefined;
  const key = ownKey();
  store.setItem(key, String(now));
  const clear = () => store.removeItem(key);
  const timer = setTimeout(clear, SETTLE_MS);
  globalThis.addEventListener?.("pagehide", clear, { once: true });
  return () => {
    clearTimeout(timer);
    clear();
  };
}

export function clearUiPluginSafeMode() {
  storage()?.removeItem(FLAG);
}

export function onUiPluginSafeModeCleared(callback: () => void) {
  globalThis.addEventListener?.("storage", (event) => {
    if (event.key === FLAG && event.newValue === null) callback();
  });
}
