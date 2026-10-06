import { readFile } from "@tauri-apps/plugin-fs";

export const MAX_SQL_FILE_BYTES = 10 * 1024 * 1024;

export function decodeSqlText(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

export async function readSqlText(path: string): Promise<string> {
  return decodeSqlText(await readFile(path));
}

export function sqlFileTitle(path: string): string {
  const segments = path.split(/[\\/]/);
  return segments[segments.length - 1] || path;
}

export function sqlFileSizeError(size: number | null | undefined): string | null {
  if (size === null || size === undefined) return null;
  if (size > MAX_SQL_FILE_BYTES) {
    const mb = Math.round(size / (1024 * 1024));
    return `Datei ist zu groß (${mb} MB, maximal ${MAX_SQL_FILE_BYTES / (1024 * 1024)} MB)`;
  }
  return null;
}

export function fileMtimeChanged(
  recorded: number | null | undefined,
  current: number | null | undefined,
): boolean {
  if (recorded === null || recorded === undefined) return false;
  if (current === null || current === undefined) return false;
  return recorded !== current;
}

export function defaultSqlFileName(title: string): string {
  const base = title.trim() || "query";
  return /\.sql$/i.test(base) ? base : `${base}.sql`;
}

export function isSqlDropName(name: string): boolean {
  return /\.sql$/i.test(name);
}

export function sqlDropPaths(paths: string[]): string[] {
  return paths.filter((path) => isSqlDropName(sqlFileTitle(path)));
}
