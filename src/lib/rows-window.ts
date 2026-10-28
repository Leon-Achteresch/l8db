export const ROWS_WINDOW_MAX_FETCHES = 2;
export const ROWS_WINDOW_MAX_EXTENT = 500_000;
export const ROWS_WINDOW_SETTLE_MS = 120;

export type RowsWindowRange = { first: number; last: number; center: number };

export function rowsWindowRange(
  firstRow: number,
  lastRow: number,
  pageSize: number,
  endRow?: number,
): RowsWindowRange {
  const prefetch = Math.max(lastRow - firstRow, Math.min(Math.ceil(pageSize / 2), 1000));
  const lastPage = endRow === undefined ? Infinity : Math.max(0, Math.ceil(endRow / pageSize) - 1);
  const clamp = (row: number) => Math.min(Math.max(0, Math.floor(row / pageSize)), lastPage);
  return {
    first: clamp(firstRow - prefetch),
    last: clamp(lastRow + prefetch),
    center: clamp((firstRow + lastRow) / 2),
  };
}

export function isRowsWindowJump(current: RowsWindowRange, next: RowsWindowRange) {
  return next.first > current.last + 1 || next.last < current.first - 1;
}

export function rowsWindowFetches(
  range: RowsWindowRange,
  isLoaded: (page: number) => boolean,
  limit = ROWS_WINDOW_MAX_FETCHES,
) {
  const pending: number[] = [];
  for (let page = range.first; page <= range.last; page++) if (!isLoaded(page)) pending.push(page);
  pending.sort((a, b) => Math.abs(a - range.center) - Math.abs(b - range.center) || a - b);
  return new Set(pending.slice(0, limit));
}

export function rowsWindowRun(range: RowsWindowRange, isLoaded: (page: number) => boolean) {
  let anchor: number | undefined;
  for (let page = range.first; page <= range.last; page++)
    if (
      isLoaded(page) &&
      (anchor === undefined || Math.abs(page - range.center) < Math.abs(anchor - range.center))
    )
      anchor = page;
  if (anchor === undefined) return null;
  let start = anchor;
  let end = anchor;
  while (start > range.first && isLoaded(start - 1)) start--;
  while (end < range.last && isLoaded(end + 1)) end++;
  return { start, end };
}

export function rowsWindowExtent(
  pageSize: number,
  lastPage: number,
  totalCount: number | undefined,
  endRow: number | undefined,
  previousExtent = 0,
) {
  if (totalCount !== undefined && totalCount <= ROWS_WINDOW_MAX_EXTENT) return totalCount;
  if (endRow !== undefined) return endRow;
  return Math.max(previousExtent, (lastPage + 2) * pageSize);
}
