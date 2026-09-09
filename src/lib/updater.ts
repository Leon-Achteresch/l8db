import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";

export const UPDATE_CHECK_TIMEOUT_MS = 20_000;

export type UpdatePromptState = {
  update: Update | null;
  open: boolean;
};

let pendingUpdate: Update | null = null;
let promptOpen = false;
let snapshot: UpdatePromptState = { update: null, open: false };
const listeners = new Set<() => void>();

function emit(): void {
  snapshot = { update: pendingUpdate, open: promptOpen };
  for (const listener of listeners) listener();
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
  const update = await check({ timeout: timeoutMs });
  if (update) setPendingUpdate(update);
  return update;
}

export async function installUpdateAndRelaunch(
  update: Update,
  onProgress?: (percent: number) => void,
): Promise<void> {
  let downloaded = 0;
  let total = 0;
  await update.downloadAndInstall((event) => {
    if (event.event === "Started") {
      total = event.data.contentLength ?? 0;
      downloaded = 0;
    } else if (event.event === "Progress") {
      downloaded += event.data.chunkLength;
    }
    if (total > 0) onProgress?.(Math.min(100, Math.round((downloaded / total) * 100)));
  });
  setPendingUpdate(null);
  await relaunch();
}

export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export function shouldRunCheck(now: number, lastCheck: number, force = false): boolean {
  if (force) return true;
  return now - lastCheck >= UPDATE_CHECK_INTERVAL_MS;
}
