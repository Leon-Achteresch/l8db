import type { QueryResult } from "@/lib/db/types";

export const TARGET_COLUMN = "__target";

export type MergeOutcome =
  | { ok: true; result: QueryResult; targets: number }
  | { ok: false; reason: string };

function sameColumns(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((column, index) => column === right[index]);
}

export function mergeResults(entries: { label: string; result: QueryResult }[]): MergeOutcome {
  const tabular = entries.filter((entry) => entry.result.columns.length > 0);
  if (!tabular.length) return { ok: false, reason: "Keine Ziele mit Ergebnismenge." };
  const columns = tabular[0].result.columns;
  if (columns.includes(TARGET_COLUMN))
    return { ok: false, reason: `Die Spalte ${TARGET_COLUMN} ist bereits im Ergebnis enthalten.` };
  const mismatch = tabular.find((entry) => !sameColumns(entry.result.columns, columns));
  if (mismatch)
    return {
      ok: false,
      reason: `Spalten von „${mismatch.label}“ (${mismatch.result.columns.join(", ")}) passen nicht zu „${tabular[0].label}“ (${columns.join(", ")}).`,
    };
  let total = 0;
  for (const entry of tabular) total += entry.result.rows.length;
  const rows: Record<string, unknown>[] = new Array(total);
  let index = 0;
  let truncated = false;
  let elapsed = 0;
  for (const entry of tabular) {
    truncated ||= Boolean(entry.result.truncated);
    elapsed = Math.max(elapsed, entry.result.execution_time_ms);
    for (const row of entry.result.rows) {
      const merged: Record<string, unknown> = { [TARGET_COLUMN]: entry.label };
      for (const column of columns) merged[column] = row[column];
      rows[index++] = merged;
    }
  }
  return {
    ok: true,
    targets: tabular.length,
    result: {
      columns: [TARGET_COLUMN, ...columns],
      rows,
      rows_affected: null,
      execution_time_ms: elapsed,
      truncated,
    },
  };
}
