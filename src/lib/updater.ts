import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";

export const UPDATE_CHECK_TIMEOUT_MS = 20_000;

let pendingUpdate: Update | null = null;

export function getPendingUpdate(): Update | null {
  return pendingUpdate;
}

export function setPendingUpdate(update: Update | null): void {
  pendingUpdate = update;
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
