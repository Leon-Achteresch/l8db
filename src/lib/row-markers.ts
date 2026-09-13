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
