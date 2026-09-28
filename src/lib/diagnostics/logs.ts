import { appLogDir, join } from "@tauri-apps/api/path";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { redactErrorMessage } from "./redact";

export async function readRecentLogLines(limit = 200): Promise<string[]> {
  const path = await join(await appLogDir(), "l8db.log");
  const text = await readTextFile(path);
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .slice(-limit)
    .map((line) => redactErrorMessage(line));
}
