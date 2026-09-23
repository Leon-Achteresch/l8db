import type { ExplainNode } from "@/lib/db";
import { planMetrics } from "@/lib/explain-compare";
import { EXPLAIN_FILE_KIND, EXPLAIN_FILE_VERSION, type SavedExplainPlan } from "@/lib/explain-file";
import { normalizeConcurrency, normalizeRepeats, numberOrNull } from "./build";
import { PERF_FILE_KIND, PERF_FILE_VERSION } from "./constants";
import type { PerfRun, PerfTestDefinition, SavedPerfTest } from "./types";

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function fileStamp(at: Date): string {
  return `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`;
}

export function fileSlug(value: string | undefined, fallback: string): string {
  const slug = (value ?? fallback)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : fallback;
}

export function defaultPerfFileName(context: { table?: string; capturedAt?: Date }): string {
  const at = context.capturedAt ?? new Date();
  return `${fileSlug(context.table, "perf")}-perf-${fileStamp(at)}.l8perf.json`;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
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
    for (const [index, child] of children.entries()) {
      validateNode(child, `${path}.Plans[${index}]`);
    }
  }
  return node as unknown as ExplainNode;
}

function parseDefinition(value: unknown): PerfTestDefinition | null {
  if (value === null || value === undefined) return null;
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
    concurrency: normalizeConcurrency(
      typeof value.concurrency === "number" ? value.concurrency : 1,
    ),
    analyze: value.analyze !== false,
    timed: value.timed === true,
  };
}

export function parsePerfRun(value: unknown, index: number): PerfRun {
  if (!isRecord(value)) {
    throw new Error(`Ungültiger Lauf bei runs[${index}]: Objekt erwartet.`);
  }
  const plan =
    value.plan === null || value.plan === undefined
      ? null
      : validateNode(value.plan, `runs[${index}].plan`);
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
      nodeCount: numberOrNull(metrics.nodeCount) ?? (plan ? planMetrics(plan).nodeCount : 0),
    },
    plan,
    error: typeof value.error === "string" && value.error.length > 0 ? value.error : null,
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
  if (data.mode !== "ANALYZE" && data.mode !== "EXPLAIN" && data.mode !== "TIMED") {
    throw new Error(
      'Ungültiger Modus in der Datei. Erlaubt sind "EXPLAIN", "ANALYZE" und "TIMED".',
    );
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
    concurrency: normalizeConcurrency(typeof data.concurrency === "number" ? data.concurrency : 1),
    elapsedMs: numberOrNull(data.elapsedMs),
    definition: parseDefinition(data.definition),
    runs: data.runs.map(parsePerfRun),
  };
}

export function perfRunAsSavedPlan(saved: SavedPerfTest, run: PerfRun): SavedExplainPlan | null {
  if (!run.plan || saved.mode === "TIMED") return null;
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
