import { syncAcrossWindows } from "@/lib/window-sync";

export const SECRET_EDITS_KEY = "l8db.secret-edits";
const CONNECTION_SECRET = /^[A-Za-z0-9_-]{1,128}(?::ssh|:ssh-jumps|:proxy|:params)?$/;
const LIMIT = 50_000;

let cache: Record<string, number> | null = null;

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readSecretEdits(): Record<string, number> {
  if (cache) return { ...cache };
  try {
    const parsed = JSON.parse(storage()?.getItem(SECRET_EDITS_KEY) ?? "{}") as unknown;
    cache =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (Object.fromEntries(
            Object.entries(parsed as Record<string, unknown>).filter(
              ([key, value]) =>
                CONNECTION_SECRET.test(key) && typeof value === "number" && Number.isFinite(value),
            ),
          ) as Record<string, number>)
        : {};
  } catch {
    cache = {};
  }
  return { ...cache };
}

export function recordSecretEdit(account: string, at: number = Date.now()): void {
  if (!CONNECTION_SECRET.test(account)) return;
  cache = null;
  const edits = readSecretEdits();
  edits[account] = at;
  const entries = Object.entries(edits);
  const kept =
    entries.length > LIMIT
      ? Object.fromEntries(entries.sort((a, b) => b[1] - a[1]).slice(0, LIMIT))
      : edits;
  cache = kept;
  try {
    storage()?.setItem(SECRET_EDITS_KEY, JSON.stringify(kept));
  } catch {
    return;
  }
}

syncAcrossWindows(SECRET_EDITS_KEY, () => {
  cache = null;
});
