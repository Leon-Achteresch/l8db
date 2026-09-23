import type { DatabaseKind, ExplainNode, QueryResult } from "@/lib/db";
import { planMetrics } from "@/lib/explain-compare";
import { identifierStyleForKind, quoteIdentifier } from "@/lib/export";
import {
  PERF_DEFAULT_CONCURRENCY,
  PERF_DEFAULT_REPEATS,
  PERF_FILE_KIND,
  PERF_FILE_VERSION,
  PERF_MAX_CONCURRENCY,
  PERF_MAX_LIMIT,
  PERF_MAX_REPEATS,
  PERF_MIN_CONCURRENCY,
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

export function normalizeConcurrency(value: number): number {
  if (!Number.isFinite(value)) return PERF_DEFAULT_CONCURRENCY;
  const rounded = Math.round(value);
  if (rounded < PERF_MIN_CONCURRENCY) return PERF_MIN_CONCURRENCY;
  if (rounded > PERF_MAX_CONCURRENCY) return PERF_MAX_CONCURRENCY;
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

function normalizedLimit(definition: PerfTestDefinition): number | null {
  return definition.limit !== null && Number.isFinite(definition.limit) && definition.limit > 0
    ? Math.min(Math.floor(definition.limit), PERF_MAX_LIMIT)
    : null;
}

function buildMongoFind(definition: PerfTestDefinition, limit: number | null): string {
  const filter = definition.filter?.trim() || "{}";
  const orderBy = definition.orderBy?.trim() ?? "";
  let command = `db.getCollection(${JSON.stringify(definition.table)}).find(${filter})`;
  if (orderBy.length > 0) command += `.sort(${orderBy})`;
  if (limit !== null) command += `.limit(${limit})`;
  return command;
}

export function buildPerfTestSql(
  definition: PerfTestDefinition,
  kind: DatabaseKind | null | undefined,
): string {
  const limit = normalizedLimit(definition);
  if (kind === "mongodb") return buildMongoFind(definition, limit);
  const target = qualifiedTarget(definition.schema, definition.table, kind);
  const filter = definition.filter?.trim() ?? "";
  const orderBy = definition.orderBy?.trim() ?? "";

  const head = kind === "mssql" && limit !== null ? `SELECT TOP ${limit} *` : "SELECT *";
  const parts = [`${head} FROM ${target}`];
  if (filter.length > 0) parts.push(`WHERE ${filter}`);
  if (orderBy.length > 0) parts.push(`ORDER BY ${orderBy}`);
  if (limit !== null && kind !== "mssql") {
    if (kind === "oracle") parts.push(`FETCH FIRST ${limit} ROWS ONLY`);
    else parts.push(`LIMIT ${limit}`);
  }
  if (kind === "cassandra" && filter.length > 0) parts.push("ALLOW FILTERING");
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

export function emptyMetrics(durationMs: number): PerfRunMetrics {
  return {
    durationMs,
    planTimeMs: null,
    rows: null,
    planRows: null,
    totalCost: null,
    sharedHitBlocks: null,
    sharedReadBlocks: null,
    nodeCount: 0,
  };
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

export function runMetricsFromResult(result: QueryResult, wallMs: number): PerfRunMetrics {
  const measured = numberOrNull(result.execution_time_ms);
  return {
    ...emptyMetrics(measured ?? wallMs),
    rows: Math.max(result.rows.length, result.rows_affected ?? 0),
  };
}

export function percentile(sorted: number[], fraction: number): number {
  const rank = Math.ceil(fraction * sorted.length) - 1;
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank))];
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
    p95: percentile(sorted, 0.95),
    max: sorted[sorted.length - 1],
    avg: sum / sorted.length,
  };
}

export function summarizeRuns(runs: PerfRun[], elapsedMs: number | null = null): PerfRunSummary {
  const succeeded = runs.filter((run) => !run.error);
  const numbers = (pick: (run: PerfRun) => number | null): number[] =>
    succeeded.map(pick).filter((value): value is number => value !== null);
  const throughputPerSec =
    elapsedMs !== null && elapsedMs > 0 && succeeded.length > 0
      ? succeeded.length / (elapsedMs / 1000)
      : null;
  return {
    duration: summarize(numbers((run) => run.metrics.durationMs)),
    rows: summarize(numbers((run) => run.metrics.rows)),
    planTime: summarize(numbers((run) => run.metrics.planTimeMs)),
    errors: runs.length - succeeded.length,
    throughputPerSec,
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
  const timed = context.timed ?? definition?.timed ?? false;
  return {
    kind: PERF_FILE_KIND,
    version: PERF_FILE_VERSION,
    capturedAt: capturedAt.toISOString(),
    mode: timed ? "TIMED" : analyze ? "ANALYZE" : "EXPLAIN",
    sql,
    connectionName: context.connectionName,
    databaseKind: context.databaseKind,
    database: context.database ?? null,
    concurrency: normalizeConcurrency(context.concurrency ?? definition?.concurrency ?? 1),
    elapsedMs: context.elapsedMs ?? null,
    definition: definition ? { ...definition } : null,
    runs,
  };
}

export function serializePerfTest(saved: SavedPerfTest): string {
  return `${JSON.stringify(saved, null, 2)}\n`;
}
