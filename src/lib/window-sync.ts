export function syncAcrossWindows(key: string, apply: (value: string | null) => void): () => void {
  if (typeof window === "undefined" || typeof window.addEventListener !== "function")
    return () => undefined;
  const listener = (event: StorageEvent) => {
    if (event.key === key) apply(event.newValue);
  };
  window.addEventListener("storage", listener);
  return () => window.removeEventListener("storage", listener);
}
