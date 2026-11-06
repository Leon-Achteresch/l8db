import { canonicalValue, compareTableData, DataCompareError, rowKeyText } from "@/lib/data-compare";
import type { QueryResult } from "@/lib/db";
import { type ColumnMask, DEFAULT_MASK_TEXT, maskValue } from "@/lib/masking";
import { DEFAULT_SELECT_ROW_LIMIT } from "@/lib/select-row-limit";

export const RESULT_COMPARE_MAX_CHARS = 4_000_000;

export interface ResultRun {
  result: QueryResult;
  sql: string;
  at: number;
  connectionId: string;
  database: string | null;
}

export interface ResultRuns {
  baseline: ResultRun | null;
  latest: ResultRun | null;
  pinned: boolean;
}

export const EMPTY_RESULT_RUNS: ResultRuns = { baseline: null, latest: null, pinned: false };

export type ResultChangeKind = "added" | "removed" | "changed";

export interface ResultChange {
  id: string;
  kind: ResultChangeKind;
  key: Record<string, unknown> | null;
  row: number;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  changed: string[];
  position: number;
}

export interface ResultComparison {
  changes: ResultChange[];
  counts: Record<ResultChangeKind | "equal", number>;
  keyColumns: string[];
  columns: { shared: string[]; added: string[]; removed: string[] };
  error: string | null;
}

function approximateChars(result: QueryResult): number {
  let total = 0;
  for (const row of result.rows) {
    for (const column of result.columns) {
      const value = row[column];
      total += typeof value === "string" ? value.length : typeof value === "object" ? 64 : 8;
    }
    if (total > RESULT_COMPARE_MAX_CHARS) break;
  }
  return total;
}

export function resultCompareLimit(result: QueryResult): string | null {
  if (result.columns.length === 0) return "Das Ergebnis hat keine Spalten.";
  if (result.truncated || result.rows.length >= DEFAULT_SELECT_ROW_LIMIT)
    return `Verglichen werden nur vollständige Ergebnisse unter ${DEFAULT_SELECT_ROW_LIMIT.toLocaleString("de-DE")} Zeilen. Grenze die Abfrage mit WHERE ein.`;
  if (approximateChars(result) > RESULT_COMPARE_MAX_CHARS)
    return "Das Ergebnis ist zu groß, um einen zweiten Lauf im Speicher zu halten.";
  return null;
}

export function nextResultRuns(runs: ResultRuns, run: ResultRun): ResultRuns {
  const latest = resultCompareLimit(run.result) === null ? run : null;
  const sameTarget = (other: ResultRun | null) =>
    other && other.connectionId === run.connectionId && other.database === run.database
      ? other
      : null;
  const pinned = runs.pinned ? sameTarget(runs.baseline) : null;
  if (pinned) return { baseline: pinned, latest, pinned: true };
  return { baseline: sameTarget(runs.latest), latest, pinned: false };
}

function sharedColumns(before: QueryResult, after: QueryResult): string[] {
  const names = new Set(before.columns);
  return after.columns.filter((column) => names.has(column));
}

function uniqueAndPresent(rows: Record<string, unknown>[], column: string): boolean {
  const seen = new Set<string>();
  for (const row of rows) {
    const value = row[column];
    if (value === null || value === undefined) return false;
    const text = canonicalValue(value);
    if (seen.has(text)) return false;
    seen.add(text);
  }
  return true;
}

export function detectKeyColumns(before: QueryResult, after: QueryResult): string[] {
  const key = sharedColumns(before, after).find(
    (column) => uniqueAndPresent(before.rows, column) && uniqueAndPresent(after.rows, column),
  );
  return key ? [key] : [];
}

function indexByKey(rows: Record<string, unknown>[], keyColumns: string[]): Map<string, number> {
  const index = new Map<string, number>();
  rows.forEach((row, position) => {
    index.set(rowKeyText(row, keyColumns), position);
  });
  return index;
}

function position(row: number, total: number): number {
  return total <= 1 ? 0 : row / (total - 1);
}

function byKey(
  before: QueryResult,
  after: QueryResult,
  keyColumns: string[],
  compareColumns: string[],
): Pick<ResultComparison, "changes" | "counts"> {
  const compared = compareTableData({
    keyColumns,
    compareColumns,
    left: before.rows,
    right: after.rows,
  });
  const beforeIndex = indexByKey(before.rows, keyColumns);
  const afterIndex = indexByKey(after.rows, keyColumns);
  const changes: ResultChange[] = [];
  for (const entry of compared.rows) {
    if (entry.category === "equal") continue;
    const kind: ResultChangeKind =
      entry.category === "only_left"
        ? "removed"
        : entry.category === "only_right"
          ? "added"
          : "changed";
    const removed = kind === "removed";
    const row = (removed ? beforeIndex : afterIndex).get(entry.keyText) ?? 0;
    changes.push({
      id: `${kind}:${entry.keyText}`,
      kind,
      key: entry.keyValues,
      row,
      before: entry.left,
      after: entry.right,
      changed: entry.differences.map((difference) => difference.column),
      position: position(row, (removed ? before : after).rows.length),
    });
  }
  return {
    changes,
    counts: {
      added: compared.counts.only_right,
      removed: compared.counts.only_left,
      changed: compared.counts.changed,
      equal: compared.counts.equal,
    },
  };
}

function byWholeRow(
  before: QueryResult,
  after: QueryResult,
  columns: string[],
): Pick<ResultComparison, "changes" | "counts"> {
  const unmatched = (
    rows: Record<string, unknown>[],
    other: Record<string, unknown>[],
  ): number[] => {
    const available = new Map<string, number>();
    for (const row of other) {
      const key = rowKeyText(row, columns);
      available.set(key, (available.get(key) ?? 0) + 1);
    }
    const rest: number[] = [];
    rows.forEach((row, index) => {
      const key = rowKeyText(row, columns);
      const count = available.get(key) ?? 0;
      if (count > 0) available.set(key, count - 1);
      else rest.push(index);
    });
    return rest;
  };
  const removed = unmatched(before.rows, after.rows);
  const added = unmatched(after.rows, before.rows);
  const changes: ResultChange[] = [
    ...removed.map((row) => ({
      id: `removed:${row}`,
      kind: "removed" as const,
      key: null,
      row,
      before: before.rows[row],
      after: null,
      changed: [],
      position: position(row, before.rows.length),
    })),
    ...added.map((row) => ({
      id: `added:${row}`,
      kind: "added" as const,
      key: null,
      row,
      before: null,
      after: after.rows[row],
      changed: [],
      position: position(row, after.rows.length),
    })),
  ];
  return {
    changes,
    counts: {
      added: added.length,
      removed: removed.length,
      changed: 0,
      equal: after.rows.length - added.length,
    },
  };
}

export function compareResults(
  before: QueryResult,
  after: QueryResult,
  keyColumns: string[],
): ResultComparison {
  const shared = sharedColumns(before, after);
  const columns = {
    shared,
    added: after.columns.filter((column) => !before.columns.includes(column)),
    removed: before.columns.filter((column) => !after.columns.includes(column)),
  };
  const keys = keyColumns.filter((column) => shared.includes(column));
  const empty = { changes: [], counts: { added: 0, removed: 0, changed: 0, equal: 0 } };
  if (shared.length === 0)
    return {
      ...empty,
      keyColumns: [],
      columns,
      error: "Die beiden Läufe haben keine gemeinsame Spalte.",
    };
  try {
    const compared =
      keys.length > 0
        ? byKey(
            before,
            after,
            keys,
            shared.filter((column) => !keys.includes(column)),
          )
        : byWholeRow(before, after, shared);
    compared.changes.sort((left, right) => left.position - right.position);
    return { ...compared, keyColumns: keys, columns, error: null };
  } catch (error) {
    if (!(error instanceof DataCompareError)) throw error;
    return {
      ...empty,
      keyColumns: keys,
      columns,
      error: `Der Schlüssel ${keys.join(", ")} ist nicht in beiden Läufen eindeutig oder enthält NULL.`,
    };
  }
}

export function compareCellText(column: string, value: unknown, masks: ColumnMask[]): string {
  const mask = masks.find((entry) => entry.column === column);
  const shown = !mask
    ? value
    : mask.mode === "shuffle"
      ? DEFAULT_MASK_TEXT
      : maskValue(column, value, mask);
  if (shown === null || shown === undefined) return "NULL";
  return typeof shown === "object" ? JSON.stringify(shown) : String(shown);
}

export function changeKeyLabel(
  change: ResultChange,
  keyColumns: string[],
  masks: ColumnMask[],
): string {
  if (!change.key || keyColumns.length === 0) return `Zeile ${change.row + 1}`;
  return keyColumns
    .map((column) => `${column} ${compareCellText(column, change.key?.[column], masks)}`)
    .join(" · ");
}
