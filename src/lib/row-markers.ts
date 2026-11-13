export function stableMarkerKey(row: unknown, primaryKeys: string[] = []): string | undefined {
  if (!row || typeof row !== "object") return undefined;
  const value = row as Record<string, unknown>;
  if (primaryKeys.length && primaryKeys.every((column) => value[column] != null)) {
    return JSON.stringify(primaryKeys.map((column) => [column, value[column]]));
  }
  if (typeof value.__ctid__ === "string") return `row:${value.__ctid__}`;
  if (value._id != null) return `document:${JSON.stringify(value._id)}`;
  return undefined;
}

export function markRowRange<T, K>(
  keys: Set<K | T>,
  rows: T[],
  from: number,
  to: number,
  keyOf: (row: T) => K | T,
): Set<K | T> {
  const end = Math.max(from, to);
  for (let index = Math.min(from, to); index <= end; index++) keys.add(keyOf(rows[index]));
  return keys;
}
