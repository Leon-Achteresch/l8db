import type { DatabaseKind, ExplainNode } from "@/lib/db";
import { planMetrics } from "@/lib/explain-compare";
import { identifierStyleForKind, quoteIdentifier } from "@/lib/export";
import {
  PERF_DEFAULT_REPEATS,
  PERF_FILE_KIND,
  PERF_FILE_VERSION,
  PERF_MAX_LIMIT,
  PERF_MAX_REPEATS,
  PERF_MIN_REPEATS,
} from "./constants";
import type {
  PerfRun,
  PerfRunMetrics,
  PerfRunSummary,
  PerfSummary,
  PerfTestContext,
  PerfTestDefinition,
  SavedPerfTest,
} from "./types";

export function normalizeRepeats(value: number): number {
  if (!Number.isFinite(value)) return PERF_DEFAULT_REPEATS;
  const rounded = Math.round(value);
  if (rounded < PERF_MIN_REPEATS) return PERF_MIN_REPEATS;
  if (rounded > PERF_MAX_REPEATS) return PERF_MAX_REPEATS;
  return rounded;
}

function qualifiedTarget(
  schema: string,
  table: string,
  kind: DatabaseKind | null | undefined,
): string {
  const style = identifierStyleForKind(kind);
  const name = quoteIdentifier(table, style);
  return schema.length > 0 ? `${quoteIdentifier(schema, style)}.${name}` : name;
}

export function buildPerfTestSql(
  definition: PerfTestDefinition,
  kind: DatabaseKind | null | undefined,
): string {
  const target = qualifiedTarget(definition.schema, definition.table, kind);
  const filter = definition.filter?.trim() ?? "";
  const orderBy = definition.orderBy?.trim() ?? "";
  const limit =
    definition.limit !== null && Number.isFinite(definition.limit) && definition.limit > 0
      ? Math.min(Math.floor(definition.limit), PERF_MAX_LIMIT)
      : null;

  const head = kind === "mssql" && limit !== null ? `SELECT TOP ${limit} *` : "SELECT *";
  const parts = [`${head} FROM ${target}`];
  if (filter.length > 0) parts.push(`WHERE ${filter}`);
  if (orderBy.length > 0) parts.push(`ORDER BY ${orderBy}`);
  if (limit !== null && kind !== "mssql") {
    if (kind === "oracle") parts.push(`FETCH FIRST ${limit} ROWS ONLY`);
    else parts.push(`LIMIT ${limit}`);
  }
  return parts.join(" ");
}

function sumNumericField(root: ExplainNode, field: string): number | null {
  let total = 0;
  let found = false;
  const walk = (node: ExplainNode) => {
    const value = node[field];
    if (typeof value === "number" && Number.isFinite(value)) {
      total += value;
      found = true;
    }
    for (const child of node.Plans ?? []) walk(child);
  };
  walk(root);
  return found ? total : null;
}

export function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function runMetricsFromPlan(
  plan: ExplainNode,
  durationMs: number,
  planRoot?: Record<string, unknown>,
): PerfRunMetrics {
  const metrics = planMetrics(plan);
  const executionTime = planRoot ? numberOrNull(planRoot["Execution Time"]) : null;
  const planningTime = planRoot ? numberOrNull(planRoot["Planning Time"]) : null;
  return {
    durationMs: executionTime ?? metrics.actualTotalTime ?? durationMs,
    planTimeMs: planningTime,
    rows: metrics.actualRows,
    planRows: metrics.planRows,
    totalCost: metrics.totalCost,
    sharedHitBlocks: sumNumericField(plan, "Shared Hit Blocks"),
    sharedReadBlocks: sumNumericField(plan, "Shared Read Blocks"),
    nodeCount: metrics.nodeCount,
  };
}

export function summarize(values: number[]): PerfSummary | null {
  const usable = values.filter((v) => typeof v === "number" && Number.isFinite(v));
  if (usable.length === 0) return null;
  const sorted = [...usable].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
  const sum = sorted.reduce((acc, value) => acc + value, 0);
  return {
    count: sorted.length,
    min: sorted[0],
    median,
    max: sorted[sorted.length - 1],
    avg: sum / sorted.length,
  };
}

export function summarizeRuns(runs: PerfRun[]): PerfRunSummary {
  const numbers = (pick: (run: PerfRun) => number | null): number[] =>
    runs.map(pick).filter((value): value is number => value !== null);
  return {
    duration: summarize(numbers((run) => run.metrics.durationMs)),
    rows: summarize(numbers((run) => run.metrics.rows)),
    planTime: summarize(numbers((run) => run.metrics.planTimeMs)),
  };
}

export function buildSavedPerfTest(
  definition: PerfTestDefinition | null,
  runs: PerfRun[],
  sql: string,
  context: PerfTestContext,
): SavedPerfTest {
  const capturedAt = context.capturedAt ?? new Date();
  const analyze = context.analyze ?? definition?.analyze ?? true;
  return {
    kind: PERF_FILE_KIND,
    version: PERF_FILE_VERSION,
    capturedAt: capturedAt.toISOString(),
    mode: analyze ? "ANALYZE" : "EXPLAIN",
    sql,
    connectionName: context.connectionName,
    databaseKind: context.databaseKind,
    database: context.database ?? null,
    definition: definition ? { ...definition } : null,
    runs,
  };
}

export function serializePerfTest(saved: SavedPerfTest): string {
  return `${JSON.stringify(saved, null, 2)}\n`;
}
