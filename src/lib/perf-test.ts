import type { DatabaseKind, ExplainNode } from "@/lib/db";
import { identifierStyleForKind, quoteIdentifier } from "@/lib/export";
import { planMetrics } from "@/lib/explain-compare";
import {
  EXPLAIN_FILE_KIND,
  EXPLAIN_FILE_VERSION,
  type SavedExplainPlan,
} from "@/lib/explain-file";

export const PERF_FILE_KIND = "l8db.perf-test";
export const PERF_FILE_VERSION = 1;
export const PERF_MIN_REPEATS = 1;
export const PERF_MAX_REPEATS = 10;
export const PERF_DEFAULT_REPEATS = 3;
export const PERF_DEFAULT_LIMIT = 1000;
export const PERF_MAX_LIMIT = 100000;

export const PERF_ANALYZE_HINT =
  "EXPLAIN ANALYZE führt die Abfrage tatsächlich aus. Der Test ist rein lesend, kann bei großen Tabellen aber Last erzeugen und dauern.";

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
  definition: PerfTestDefinition;
  runs: PerfRun[];
}

export interface PerfTestContext {
  connectionName: string;
  databaseKind: string;
  database?: string | null;
  capturedAt?: Date;
}

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

function numberOrNull(value: unknown): number | null {
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
  definition: PerfTestDefinition,
  runs: PerfRun[],
  sql: string,
  context: PerfTestContext,
): SavedPerfTest {
  const capturedAt = context.capturedAt ?? new Date();
  return {
    kind: PERF_FILE_KIND,
    version: PERF_FILE_VERSION,
    capturedAt: capturedAt.toISOString(),
    mode: definition.analyze ? "ANALYZE" : "EXPLAIN",
    sql,
    connectionName: context.connectionName,
    databaseKind: context.databaseKind,
    database: context.database ?? null,
    definition: { ...definition },
    runs,
  };
}

export function serializePerfTest(saved: SavedPerfTest): string {
  return `${JSON.stringify(saved, null, 2)}\n`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function defaultPerfFileName(context: {
  table?: string;
  capturedAt?: Date;
}): string {
  const at = context.capturedAt ?? new Date();
  const stamp = `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`;
  const slug = (context.table ?? "perf")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const base = slug.length > 0 ? slug : "perf";
  return `${base}-perf-${stamp}.l8perf.json`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateNode(node: unknown, path: string): ExplainNode {
  if (!isRecord(node)) {
    throw new Error(`Ungültiger Planknoten bei ${path}: Objekt erwartet.`);
  }
  if (typeof node["Node Type"] !== "string" || node["Node Type"].length === 0) {
    throw new Error(`Ungültiger Planknoten bei ${path}: Feld "Node Type" fehlt.`);
  }
  const children = node.Plans;
  if (children !== undefined) {
    if (!Array.isArray(children)) {
      throw new Error(`Ungültiger Planknoten bei ${path}: "Plans" muss eine Liste sein.`);
    }
    children.forEach((child, index) => validateNode(child, `${path}.Plans[${index}]`));
  }
  return node as unknown as ExplainNode;
}

function parseDefinition(value: unknown): PerfTestDefinition {
  if (!isRecord(value)) {
    throw new Error("Die Testdefinition fehlt in der Datei.");
  }
  if (typeof value.table !== "string" || value.table.length === 0) {
    throw new Error("Die Testdefinition enthält kein Zielobjekt.");
  }
  return {
    schema: typeof value.schema === "string" ? value.schema : "",
    table: value.table,
    filter: typeof value.filter === "string" ? value.filter : null,
    orderBy: typeof value.orderBy === "string" ? value.orderBy : null,
    limit: typeof value.limit === "number" && Number.isFinite(value.limit) ? value.limit : null,
    repeats: normalizeRepeats(typeof value.repeats === "number" ? value.repeats : 1),
    analyze: value.analyze !== false,
  };
}

function parseRun(value: unknown, index: number): PerfRun {
  if (!isRecord(value)) {
    throw new Error(`Ungültiger Lauf bei runs[${index}]: Objekt erwartet.`);
  }
  const plan = validateNode(value.plan, `runs[${index}].plan`);
  const metrics = isRecord(value.metrics) ? value.metrics : {};
  return {
    index: typeof value.index === "number" ? value.index : index + 1,
    startedAt: typeof value.startedAt === "string" ? value.startedAt : "",
    metrics: {
      durationMs: numberOrNull(metrics.durationMs) ?? 0,
      planTimeMs: numberOrNull(metrics.planTimeMs),
      rows: numberOrNull(metrics.rows),
      planRows: numberOrNull(metrics.planRows),
      totalCost: numberOrNull(metrics.totalCost),
      sharedHitBlocks: numberOrNull(metrics.sharedHitBlocks),
      sharedReadBlocks: numberOrNull(metrics.sharedReadBlocks),
      nodeCount: numberOrNull(metrics.nodeCount) ?? planMetrics(plan).nodeCount,
    },
    plan,
  };
}

export function parsePerfTestFile(text: string): SavedPerfTest {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Die Datei ist kein gültiges JSON und kann nicht gelesen werden.");
  }
  if (!isRecord(data)) {
    throw new Error("Die Datei enthält keine l8db-Performance-Daten.");
  }
  if (data.kind !== PERF_FILE_KIND) {
    throw new Error(
      "Die Datei ist keine l8db-Performance-Datei. Erwartet wird eine mit l8db gespeicherte Datei (.l8perf.json).",
    );
  }
  if (typeof data.version !== "number" || !Number.isInteger(data.version)) {
    throw new Error("Die Dateiversion fehlt oder ist ungültig.");
  }
  if (data.version > PERF_FILE_VERSION) {
    throw new Error(
      `Unbekannte Dateiversion ${data.version}. Diese l8db-Version unterstützt höchstens Version ${PERF_FILE_VERSION}. Bitte l8db aktualisieren.`,
    );
  }
  if (data.mode !== "ANALYZE" && data.mode !== "EXPLAIN") {
    throw new Error('Ungültiger Modus in der Datei. Erlaubt sind "EXPLAIN" und "ANALYZE".');
  }
  if (typeof data.sql !== "string") {
    throw new Error("Der SQL-Text fehlt in der Datei.");
  }
  if (!Array.isArray(data.runs) || data.runs.length === 0) {
    throw new Error("Die Datei enthält keine Läufe.");
  }
  return {
    kind: PERF_FILE_KIND,
    version: data.version,
    capturedAt: typeof data.capturedAt === "string" ? data.capturedAt : "",
    mode: data.mode,
    sql: data.sql,
    connectionName: typeof data.connectionName === "string" ? data.connectionName : "",
    databaseKind: typeof data.databaseKind === "string" ? data.databaseKind : "",
    database: typeof data.database === "string" ? data.database : null,
    definition: parseDefinition(data.definition),
    runs: data.runs.map(parseRun),
  };
}

export function perfRunAsSavedPlan(saved: SavedPerfTest, run: PerfRun): SavedExplainPlan {
  return {
    kind: EXPLAIN_FILE_KIND,
    version: EXPLAIN_FILE_VERSION,
    capturedAt: run.startedAt || saved.capturedAt,
    mode: saved.mode,
    sql: saved.sql,
    connectionName: saved.connectionName,
    databaseKind: saved.databaseKind,
    database: saved.database,
    plan: run.plan,
  };
}
