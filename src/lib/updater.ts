import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { Update } from "@tauri-apps/plugin-updater";
import { checkUpdate } from "@/lib/db/updates";
import { useSettingsStore } from "@/lib/settings";

export const UPDATE_CHECK_TIMEOUT_MS = 20_000;

export type UpdatePromptState = {
  update: Update | null;
  open: boolean;
};

let pendingUpdate: Update | null = null;
let promptOpen = false;
let installPercent: number | null = null;
let snapshot: UpdatePromptState = { update: null, open: false };
const listeners = new Set<() => void>();

function emit(): void {
  snapshot = { update: pendingUpdate, open: promptOpen };
  for (const listener of listeners) listener();
}

function setInstallPercent(percent: number | null): void {
  if (installPercent === percent) return;
  installPercent = percent;
  for (const listener of listeners) listener();
}

export function getInstallPercent(): number | null {
  return installPercent;
}

export function getPendingUpdate(): Update | null {
  return pendingUpdate;
}

export function getUpdatePromptState(): UpdatePromptState {
  return snapshot;
}

export function subscribeUpdatePrompt(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setPendingUpdate(update: Update | null): void {
  pendingUpdate = update;
  if (!update) promptOpen = false;
  emit();
}

export function presentUpdate(update: Update): void {
  pendingUpdate = update;
  promptOpen = true;
  emit();
}

export function closeUpdatePrompt(): void {
  promptOpen = false;
  emit();
}

export async function getAppVersion(): Promise<string | null> {
  try {
    return await getVersion();
  } catch {
    return null;
  }
}

export async function checkForUpdates(timeoutMs = UPDATE_CHECK_TIMEOUT_MS): Promise<Update | null> {
  const metadata = await checkUpdate(useSettingsStore.getState().updateChannel, timeoutMs);
  const update = metadata ? new Update(metadata) : null;
  if (update) setPendingUpdate(update);
  return update;
}

function flushPendingState(): void {
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return;
  window.dispatchEvent(new Event("pagehide"));
  window.dispatchEvent(new Event("pagehide"));
}

export async function installUpdateAndRelaunch(
  update: Update,
  onProgress?: (percent: number) => void,
  canRelaunch?: () => Promise<boolean>,
): Promise<boolean> {
  let downloaded = 0;
  let total = 0;
  setInstallPercent(0);
  try {
    await update.download((event) => {
      if (event.event === "Started") {
        total = event.data.contentLength ?? 0;
        downloaded = 0;
      } else if (event.event === "Progress") {
        downloaded += event.data.chunkLength;
      }
      if (total <= 0) return;
      const percent = Math.min(100, Math.round((downloaded / total) * 100));
      setInstallPercent(percent);
      onProgress?.(percent);
    });
    if (canRelaunch && !(await canRelaunch())) return false;
    setInstallPercent(100);
    flushPendingState();
    await update.install();
    setPendingUpdate(null);
    await relaunch();
    return true;
  } finally {
    setInstallPercent(null);
  }
}

export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export function shouldRunCheck(now: number, lastCheck: number, force = false): boolean {
  if (force) return true;
  return now - lastCheck >= UPDATE_CHECK_INTERVAL_MS;
}
