import type { QueryResult } from "@/lib/db";
import {
  emptyMetrics,
  isReadOnlyStatement,
  type PerfRun,
  runMetricsFromResult,
  runPerfLoop,
  stripSqlNoise,
} from "@/lib/perf-test";
import { detectPlaceholders, numberPlaceholders } from "./placeholders";
import type { WorkloadStatement, WorkloadStatementResult } from "./types";

export interface WorkloadRunOptions {
  statements: WorkloadStatement[];
  repeats: number;
  concurrency: number;
  kind: string;
  bindable: boolean;
  execute: (sql: string, params: string[] | null) => Promise<QueryResult>;
  isCancelled?: () => boolean;
  onProgress?: (statement: number, done: number, total: number) => void;
}

export function skipReason(
  statement: WorkloadStatement,
  kind: string,
  bindable: boolean,
): string | null {
  const sql = stripSqlNoise(statement.sql);
  if (!isReadOnlyStatement(sql)) {
    return "Nur lesende Einzelanweisungen (SELECT/WITH) werden abgespielt.";
  }
  const placeholders = detectPlaceholders(sql, kind);
  if (placeholders.length === 0) return null;
  if (!bindable) {
    return `Platzhalter (${placeholders.join(", ")}) lassen sich auf dieser Datenbank nicht binden.`;
  }
  const params = statement.params ?? [];
  const missing = placeholders.filter((_, index) => (params[index] ?? "").length === 0);
  if (missing.length > 0) return `Werte für ${missing.join(", ")} fehlen.`;
  return null;
}

export async function runWorkload(options: WorkloadRunOptions): Promise<WorkloadStatementResult[]> {
  const results: WorkloadStatementResult[] = [];
  for (const [position, statement] of options.statements.entries()) {
    if (options.isCancelled?.()) break;
    const skipped = skipReason(statement, options.kind, options.bindable);
    if (skipped) {
      results.push({ sql: statement.sql, skipped, runs: [], elapsedMs: 0 });
      continue;
    }
    const cleaned = stripSqlNoise(statement.sql);
    const placeholders = detectPlaceholders(cleaned, options.kind);
    const params =
      placeholders.length > 0 ? (statement.params ?? []).slice(0, placeholders.length) : null;
    const sql = params ? numberPlaceholders(cleaned, options.kind) : cleaned;
    const execute = async (index: number): Promise<PerfRun> => {
      const startedAt = new Date().toISOString();
      const started = performance.now();
      try {
        const result = await options.execute(sql, params);
        return {
          index,
          startedAt,
          metrics: runMetricsFromResult(result, performance.now() - started),
          plan: null,
          error: null,
        };
      } catch (err) {
        return {
          index,
          startedAt,
          metrics: emptyMetrics(performance.now() - started),
          plan: null,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    };
    const outcome = await runPerfLoop({
      repeats: options.repeats,
      concurrency: options.concurrency,
      execute,
      isCancelled: options.isCancelled,
      onProgress: (done, total) => options.onProgress?.(position, done, total),
    });
    results.push({
      sql: statement.sql,
      skipped: null,
      runs: outcome.runs,
      elapsedMs: outcome.elapsedMs,
    });
    if (outcome.cancelled) break;
  }
  return results;
}
