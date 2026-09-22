import { stripSqlNoise, summarizeRuns } from "@/lib/perf-test";
import type { SavedWorkloadResult, WorkloadComparisonRow, WorkloadStatementResult } from "./types";

export function normalizeStatement(sql: string): string {
  return stripSqlNoise(sql).replace(/\s+/g, " ").trim().toLowerCase();
}

function summaryOf(result: WorkloadStatementResult | undefined) {
  if (!result || result.skipped) return { duration: null, errors: 0 };
  const summary = summarizeRuns(result.runs, result.elapsedMs);
  return { duration: summary.duration, errors: summary.errors };
}

export function compareWorkloadResults(
  left: SavedWorkloadResult,
  right: SavedWorkloadResult,
): WorkloadComparisonRow[] {
  const rightByKey = new Map(
    right.results.map((result) => [normalizeStatement(result.sql), result]),
  );
  const seen = new Set<string>();
  const rows: WorkloadComparisonRow[] = [];
  for (const result of left.results) {
    const key = normalizeStatement(result.sql);
    seen.add(key);
    const counterpart = rightByKey.get(key);
    const a = summaryOf(result);
    const b = summaryOf(counterpart);
    const deltaMs = a.duration && b.duration ? b.duration.median - a.duration.median : null;
    rows.push({
      sql: result.sql,
      status: counterpart ? "both" : "only-left",
      left: a.duration,
      right: b.duration,
      leftErrors: a.errors,
      rightErrors: b.errors,
      deltaMs,
      ratio:
        deltaMs !== null && a.duration && a.duration.median > 0
          ? deltaMs / a.duration.median
          : null,
    });
  }
  for (const result of right.results) {
    const key = normalizeStatement(result.sql);
    if (seen.has(key)) continue;
    const b = summaryOf(result);
    rows.push({
      sql: result.sql,
      status: "only-right",
      left: null,
      right: b.duration,
      leftErrors: 0,
      rightErrors: b.errors,
      deltaMs: null,
      ratio: null,
    });
  }
  return rows;
}
