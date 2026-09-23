import type { QueryStatEntry } from "@/lib/query-stats";
import {
  WORKLOAD_FILE_KIND,
  WORKLOAD_FILE_VERSION,
  WORKLOAD_MAX_STATEMENTS,
  WORKLOAD_RESULT_FILE_KIND,
} from "./constants";
import type {
  SavedWorkload,
  SavedWorkloadResult,
  WorkloadContext,
  WorkloadStatement,
  WorkloadStatementResult,
} from "./types";

export function statementsFromStats(entries: QueryStatEntry[]): WorkloadStatement[] {
  return entries.slice(0, WORKLOAD_MAX_STATEMENTS).map((entry) => ({
    sql: entry.sql,
    calls: entry.calls,
    meanMs: entry.meanMs,
    params: null,
  }));
}

export function buildSavedWorkload(
  statements: WorkloadStatement[],
  context: WorkloadContext,
): SavedWorkload {
  return {
    kind: WORKLOAD_FILE_KIND,
    version: WORKLOAD_FILE_VERSION,
    capturedAt: (context.capturedAt ?? new Date()).toISOString(),
    connectionName: context.connectionName,
    databaseKind: context.databaseKind,
    database: context.database ?? null,
    statements: statements.map((statement) => ({ ...statement })),
  };
}

export function buildSavedWorkloadResult(
  results: WorkloadStatementResult[],
  options: { repeats: number; concurrency: number },
  context: WorkloadContext,
): SavedWorkloadResult {
  return {
    kind: WORKLOAD_RESULT_FILE_KIND,
    version: WORKLOAD_FILE_VERSION,
    capturedAt: (context.capturedAt ?? new Date()).toISOString(),
    connectionName: context.connectionName,
    databaseKind: context.databaseKind,
    database: context.database ?? null,
    repeats: options.repeats,
    concurrency: options.concurrency,
    results,
  };
}

export function serializeWorkload(saved: SavedWorkload | SavedWorkloadResult): string {
  return `${JSON.stringify(saved, null, 2)}\n`;
}
