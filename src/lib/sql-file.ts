export const MAX_SQL_FILE_BYTES = 10 * 1024 * 1024;

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
