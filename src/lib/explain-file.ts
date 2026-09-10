import type { ExplainNode } from "@/lib/db";

export const EXPLAIN_FILE_KIND = "l8db.explain-plan";
export const EXPLAIN_FILE_VERSION = 1;

export type ExplainCaptureMode = "EXPLAIN" | "ANALYZE";

export interface SavedExplainPlan {
  kind: typeof EXPLAIN_FILE_KIND;
  version: number;
  capturedAt: string;
  mode: ExplainCaptureMode;
  sql: string;
  connectionName: string;
  databaseKind: string;
  database: string | null;
  plan: ExplainNode;
}

export interface ExplainPlanContext {
  sql: string;
  connectionName: string;
  databaseKind: string;
  database?: string | null;
  analyzed: boolean;
  capturedAt?: Date;
}

export const EXPLAIN_EXPORT_HINT =
  "Die Datei enthält den vollständigen SQL-Text und den Plan. Darin können Literale, Filterwerte und Tabellennamen aus Ihren Daten stehen. Zugangsdaten werden nicht gespeichert.";

const SECRET_KEYS = new Set([
  "connectionString",
  "connection_string",
  "password",
  "passwort",
  "user",
  "username",
  "secret",
  "token",
  "sshPassword",
  "privateKey",
]);

function stripSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripSecrets);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEYS.has(key)) continue;
      out[key] = stripSecrets(entry);
    }
    return out;
  }
  return value;
}

export function buildSavedExplainPlan(
  plan: ExplainNode,
  context: ExplainPlanContext,
): SavedExplainPlan {
  const capturedAt = context.capturedAt ?? new Date();
  return {
    kind: EXPLAIN_FILE_KIND,
    version: EXPLAIN_FILE_VERSION,
    capturedAt: capturedAt.toISOString(),
    mode: context.analyzed ? "ANALYZE" : "EXPLAIN",
    sql: context.sql,
    connectionName: context.connectionName,
    databaseKind: context.databaseKind,
    database: context.database ?? null,
    plan: stripSecrets(plan) as ExplainNode,
  };
}

export function serializeExplainPlan(saved: SavedExplainPlan): string {
  return `${JSON.stringify(saved, null, 2)}\n`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function defaultExplainFileName(context: {
  connectionName?: string;
  analyzed: boolean;
  capturedAt?: Date;
}): string {
  const at = context.capturedAt ?? new Date();
  const stamp = `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`;
  const slug = (context.connectionName ?? "plan")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const base = slug.length > 0 ? slug : "plan";
  return `${base}-${context.analyzed ? "analyze" : "explain"}-${stamp}.l8plan.json`;
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
    for (const [index, child] of children.entries()) {
      validateNode(child, `${path}.Plans[${index}]`);
    }
  }
  return node as unknown as ExplainNode;
}

export function parseExplainPlanFile(text: string): SavedExplainPlan {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Die Datei ist kein gültiges JSON und kann nicht gelesen werden.");
  }
  if (!isRecord(data)) {
    throw new Error("Die Datei enthält keine l8db-Plandaten.");
  }
  if (data.kind !== EXPLAIN_FILE_KIND) {
    throw new Error(
      "Die Datei ist keine l8db-Plandatei. Erwartet wird eine mit l8db gespeicherte Datei (.l8plan.json).",
    );
  }
  if (typeof data.version !== "number" || !Number.isInteger(data.version)) {
    throw new Error("Die Dateiversion fehlt oder ist ungültig.");
  }
  if (data.version > EXPLAIN_FILE_VERSION) {
    throw new Error(
      `Unbekannte Dateiversion ${data.version}. Diese l8db-Version unterstützt höchstens Version ${EXPLAIN_FILE_VERSION}. Bitte l8db aktualisieren.`,
    );
  }
  if (data.mode !== "EXPLAIN" && data.mode !== "ANALYZE") {
    throw new Error('Ungültiger Modus in der Datei. Erlaubt sind "EXPLAIN" und "ANALYZE".');
  }
  if (typeof data.sql !== "string") {
    throw new Error("Der SQL-Text fehlt in der Datei.");
  }
  const plan = validateNode(data.plan, "plan");
  return {
    kind: EXPLAIN_FILE_KIND,
    version: data.version,
    capturedAt: typeof data.capturedAt === "string" ? data.capturedAt : "",
    mode: data.mode,
    sql: data.sql,
    connectionName: typeof data.connectionName === "string" ? data.connectionName : "",
    databaseKind: typeof data.databaseKind === "string" ? data.databaseKind : "",
    database: typeof data.database === "string" ? data.database : null,
    plan,
  };
}

export function formatCapturedAt(value: string): string {
  if (!value) return "unbekannt";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("de-DE");
}
