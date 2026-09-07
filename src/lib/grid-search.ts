import { compileRegexSearch, type RegexCompileError } from "@/lib/regex-search";

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

export type GridSearchOptions = {
  regex?: boolean;
  caseSensitive?: boolean;
};

export type GridSearchResult = {
  matches: GridMatch[];
  error: RegexCompileError | null;
};

export function runGridSearch(
  rows: Record<string, unknown>[],
  columns: string[],
  query: string,
  options: GridSearchOptions = {},
): GridSearchResult {
  const trimmed = query.trim();
  if (trimmed === "") return { matches: [], error: null };

  const matches: GridMatch[] = [];

  if (options.regex) {
    const compiled = compileRegexSearch(trimmed, {
      caseSensitive: options.caseSensitive,
      global: false,
    });
    if (!compiled.ok) return { matches: [], error: compiled.error };
    rows.forEach((row, rowIndex) => {
      for (const columnId of columns) {
        if (compiled.regex.test(gridCellText(row[columnId]))) {
          matches.push({ rowIndex, columnId });
        }
      }
    });
    return { matches, error: null };
  }

  const needle = options.caseSensitive ? trimmed : trimmed.toLowerCase();
  rows.forEach((row, rowIndex) => {
    for (const columnId of columns) {
      const text = gridCellText(row[columnId]);
      const haystack = options.caseSensitive ? text : text.toLowerCase();
      if (haystack.includes(needle)) {
        matches.push({ rowIndex, columnId });
      }
    }
  });
  return { matches, error: null };
}

export function findGridMatches(
  rows: Record<string, unknown>[],
  columns: string[],
  query: string,
  options: GridSearchOptions = {},
): GridMatch[] {
  return runGridSearch(rows, columns, query, options).matches;
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
