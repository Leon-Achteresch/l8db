import type { PerfRun, PerfSummary } from "@/lib/perf-test";
import type { WORKLOAD_FILE_KIND, WORKLOAD_RESULT_FILE_KIND } from "./constants";

export interface WorkloadStatement {
  sql: string;
  calls: number | null;
  meanMs: number | null;
  params: string[] | null;
}

export interface WorkloadContext {
  connectionName: string;
  databaseKind: string;
  database?: string | null;
  capturedAt?: Date;
}

export interface SavedWorkload {
  kind: typeof WORKLOAD_FILE_KIND;
  version: number;
  capturedAt: string;
  connectionName: string;
  databaseKind: string;
  database: string | null;
  statements: WorkloadStatement[];
}

export interface WorkloadStatementResult {
  sql: string;
  skipped: string | null;
  runs: PerfRun[];
  elapsedMs: number;
}

export interface SavedWorkloadResult {
  kind: typeof WORKLOAD_RESULT_FILE_KIND;
  version: number;
  capturedAt: string;
  connectionName: string;
  databaseKind: string;
  database: string | null;
  repeats: number;
  concurrency: number;
  results: WorkloadStatementResult[];
}

export type WorkloadComparisonStatus = "both" | "only-left" | "only-right";

export interface WorkloadComparisonRow {
  sql: string;
  status: WorkloadComparisonStatus;
  left: PerfSummary | null;
  right: PerfSummary | null;
  leftErrors: number;
  rightErrors: number;
  deltaMs: number | null;
  ratio: number | null;
}
