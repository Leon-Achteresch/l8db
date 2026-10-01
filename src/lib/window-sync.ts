export function syncAcrossWindows(key: string, apply: (value: string | null) => void): void {
  if (typeof window === "undefined" || typeof window.addEventListener !== "function") return;
  window.addEventListener("storage", (event) => {
    if (event.key === key) apply(event.newValue);
  });
}
