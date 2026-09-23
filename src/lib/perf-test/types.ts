import type { ExplainNode } from "@/lib/db";
import type { PERF_FILE_KIND } from "./constants";

export type PerfMode = "ANALYZE" | "EXPLAIN" | "TIMED";

export interface PerfTestDefinition {
  schema: string;
  table: string;
  filter: string | null;
  orderBy: string | null;
  limit: number | null;
  repeats: number;
  concurrency: number;
  analyze: boolean;
  timed: boolean;
}

export interface PerfRunMetrics {
  durationMs: number;
  planTimeMs: number | null;
  rows: number | null;
  planRows: number | null;
  totalCost: number | null;
  sharedHitBlocks: number | null;
  sharedReadBlocks: number | null;
  nodeCount: number;
}

export interface PerfRun {
  index: number;
  startedAt: string;
  metrics: PerfRunMetrics;
  plan: ExplainNode | null;
  error?: string | null;
}

export interface PerfSummary {
  count: number;
  min: number;
  median: number;
  p95: number;
  max: number;
  avg: number;
}

export interface PerfRunSummary {
  duration: PerfSummary | null;
  rows: PerfSummary | null;
  planTime: PerfSummary | null;
  errors: number;
  throughputPerSec: number | null;
}

export interface SavedPerfTest {
  kind: typeof PERF_FILE_KIND;
  version: number;
  capturedAt: string;
  mode: PerfMode;
  sql: string;
  connectionName: string;
  databaseKind: string;
  database: string | null;
  concurrency: number;
  elapsedMs: number | null;
  definition: PerfTestDefinition | null;
  runs: PerfRun[];
}

export interface PerfTestContext {
  connectionName: string;
  databaseKind: string;
  database?: string | null;
  capturedAt?: Date;
  analyze?: boolean;
  timed?: boolean;
  concurrency?: number;
  elapsedMs?: number | null;
}
