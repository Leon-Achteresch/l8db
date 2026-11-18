import { readFile } from "@tauri-apps/plugin-fs";

export const MAX_SQL_FILE_BYTES = 10 * 1024 * 1024;

export const SQL_FILE_READ_OPTIONS = [
  { value: "auto", label: "Automatisch (UTF-8 / Windows-1252)" },
  { value: "utf-16le", label: "UTF-16 LE" },
  { value: "utf-16be", label: "UTF-16 BE" },
] as const;

export type SqlFileReadEncoding = (typeof SQL_FILE_READ_OPTIONS)[number]["value"];

export function isSqlFileReadEncoding(value: unknown): value is SqlFileReadEncoding {
  return SQL_FILE_READ_OPTIONS.some((option) => option.value === value);
}

export function decodeSqlFile(
  bytes: Uint8Array,
  encoding: SqlFileReadEncoding = "auto",
): { text: string; requiresUtf8Copy: boolean } {
  const bom =
    bytes[0] === 0xff && bytes[1] === 0xfe
      ? "utf-16le"
      : bytes[0] === 0xfe && bytes[1] === 0xff
        ? "utf-16be"
        : bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
          ? "utf-8"
          : null;
  if (encoding !== "auto") {
    if (!isSqlFileReadEncoding(encoding)) throw new Error("Lesekodierung wird nicht unterstützt.");
    if (bom && bom !== encoding) {
      throw new Error("Die Dateimarkierung passt nicht zur gewählten Kodierung.");
    }
    try {
      return {
        text: new TextDecoder(encoding, { fatal: true }).decode(bytes),
        requiresUtf8Copy: true,
      };
    } catch {
      throw new Error(`Ungültige Dateibytes für ${encoding.toUpperCase()}.`);
    }
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { text, requiresUtf8Copy: bytes.includes(0) };
  } catch {
    return { text: new TextDecoder("windows-1252").decode(bytes), requiresUtf8Copy: true };
  }
}

export function decodeSqlText(bytes: Uint8Array): string {
  return decodeSqlFile(bytes).text;
}

export async function readSqlText(path: string): Promise<string> {
  return decodeSqlText(await readFile(path));
}

export async function readSqlFile(path: string, encoding: SqlFileReadEncoding) {
  const bytes = await readFile(path);
  const sizeError = sqlFileSizeError(bytes.byteLength);
  if (sizeError) throw new Error(sizeError);
  return decodeSqlFile(bytes, encoding);
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
