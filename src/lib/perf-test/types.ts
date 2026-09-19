import type { ExplainNode } from "@/lib/db";
import type { PERF_FILE_KIND } from "./constants";

export interface PerfTestDefinition {
  schema: string;
  table: string;
  filter: string | null;
  orderBy: string | null;
  limit: number | null;
  repeats: number;
  analyze: boolean;
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
  plan: ExplainNode;
}

export interface PerfSummary {
  count: number;
  min: number;
  median: number;
  max: number;
  avg: number;
}

export interface PerfRunSummary {
  duration: PerfSummary | null;
  rows: PerfSummary | null;
  planTime: PerfSummary | null;
}

export interface SavedPerfTest {
  kind: typeof PERF_FILE_KIND;
  version: number;
  capturedAt: string;
  mode: "ANALYZE" | "EXPLAIN";
  sql: string;
  connectionName: string;
  databaseKind: string;
  database: string | null;
  definition: PerfTestDefinition | null;
  runs: PerfRun[];
}

export interface PerfTestContext {
  connectionName: string;
  databaseKind: string;
  database?: string | null;
  capturedAt?: Date;
  analyze?: boolean;
}
