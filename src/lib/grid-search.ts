export type GridMatch = {
  rowIndex: number;
  columnId: string;
};

export function gridCellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function gridMatchKey(rowIndex: number, columnId: string): string {
  return `${rowIndex}:${columnId}`;
}

export function findGridMatches(
  rows: Record<string, unknown>[],
  columns: string[],
  query: string,
): GridMatch[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [];
  const matches: GridMatch[] = [];
  rows.forEach((row, rowIndex) => {
    for (const columnId of columns) {
      if (gridCellText(row[columnId]).toLowerCase().includes(needle)) {
        matches.push({ rowIndex, columnId });
      }
    }
  });
  return matches;
}

export function stepMatchIndex(current: number, total: number, step: number): number {
  if (total <= 0) return 0;
  const safeCurrent = current < 0 || current >= total ? 0 : current;
  return (((safeCurrent + step) % total) + total) % total;
}

export function describeGridSearch(matchCount: number, activeIndex: number): string {
  if (matchCount === 0) return "0 Treffer";
  return `${Math.min(activeIndex + 1, matchCount)} von ${matchCount}`;
}
