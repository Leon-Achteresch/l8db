export function pendingEnterItem<T>(
  pending: string | null,
  rankedQuery: string,
  search: string,
  rows: readonly T[],
): T | undefined {
  return pending !== null && pending === search && rankedQuery === search ? rows[0] : undefined;
}
