import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";

export async function checkForUpdates(): Promise<Update | null> {
  try {
    return await check();
  } catch {
    return null;
  }
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
  await relaunch();
}
