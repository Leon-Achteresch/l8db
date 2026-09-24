import { open, save } from "@tauri-apps/plugin-dialog";
import { readFile, stat, writeFile } from "@tauri-apps/plugin-fs";

export const MAX_BINARY_FILE_BYTES = 16 * 1024 * 1024;

export async function saveBytesToFile(bytes: Uint8Array, defaultName: string): Promise<boolean> {
  const path = await save({ defaultPath: defaultName });
  if (!path) return false;
  await writeFile(path, bytes);
  return true;
}

export async function pickBytesFromFile(): Promise<{ name: string; bytes: Uint8Array } | null> {
  const path = await open({ multiple: false, directory: false });
  if (typeof path !== "string") return null;
  const meta = await stat(path);
  if (meta.size > MAX_BINARY_FILE_BYTES)
    throw new Error(
      `Datei ist zu groß. Maximal ${MAX_BINARY_FILE_BYTES / 1024 / 1024} MB können geladen werden.`,
    );
  const bytes = await readFile(path);
  return { name: path.split(/[\\/]/).pop() ?? path, bytes };
}
