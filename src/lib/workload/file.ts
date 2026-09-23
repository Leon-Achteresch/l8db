import { fileSlug, fileStamp, isRecord, parsePerfRun } from "@/lib/perf-test";
import { toNumber } from "@/lib/query-stats";
import {
  WORKLOAD_FILE_KIND,
  WORKLOAD_FILE_VERSION,
  WORKLOAD_MAX_STATEMENTS,
  WORKLOAD_RESULT_FILE_KIND,
} from "./constants";
import type {
  SavedWorkload,
  SavedWorkloadResult,
  WorkloadStatement,
  WorkloadStatementResult,
} from "./types";

export function defaultWorkloadFileName(context: { name?: string; capturedAt?: Date }): string {
  return `${fileSlug(context.name, "workload")}-workload-${fileStamp(context.capturedAt ?? new Date())}.l8workload.json`;
}

export function defaultWorkloadResultFileName(context: {
  name?: string;
  capturedAt?: Date;
}): string {
  return `${fileSlug(context.name, "workload")}-result-${fileStamp(context.capturedAt ?? new Date())}.l8wlresult.json`;
}

function parseJson(text: string): Record<string, unknown> {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Die Datei ist kein gültiges JSON und kann nicht gelesen werden.");
  }
  if (!isRecord(data)) {
    throw new Error("Die Datei enthält keine l8db-Workload-Daten.");
  }
  return data;
}

function checkVersion(data: Record<string, unknown>): number {
  if (typeof data.version !== "number" || !Number.isInteger(data.version)) {
    throw new Error("Die Dateiversion fehlt oder ist ungültig.");
  }
  if (data.version > WORKLOAD_FILE_VERSION) {
    throw new Error(
      `Unbekannte Dateiversion ${data.version}. Diese l8db-Version unterstützt höchstens Version ${WORKLOAD_FILE_VERSION}. Bitte l8db aktualisieren.`,
    );
  }
  return data.version;
}

function parseStatement(value: unknown, index: number): WorkloadStatement {
  if (!isRecord(value) || typeof value.sql !== "string" || value.sql.trim().length === 0) {
    throw new Error(`Ungültiges Statement bei statements[${index}]: SQL-Text fehlt.`);
  }
  const params = Array.isArray(value.params)
    ? value.params.map((param) => (param === null || param === undefined ? "" : String(param)))
    : null;
  return {
    sql: value.sql,
    calls: toNumber(value.calls),
    meanMs: toNumber(value.meanMs),
    params,
  };
}

export function parseWorkloadFile(text: string): SavedWorkload {
  const data = parseJson(text);
  if (data.kind !== WORKLOAD_FILE_KIND) {
    throw new Error(
      "Die Datei ist keine l8db-Workload-Datei. Erwartet wird eine mit l8db gespeicherte Datei (.l8workload.json).",
    );
  }
  const version = checkVersion(data);
  if (!Array.isArray(data.statements) || data.statements.length === 0) {
    throw new Error("Die Datei enthält keine Statements.");
  }
  if (data.statements.length > WORKLOAD_MAX_STATEMENTS) {
    throw new Error(`Die Datei enthält mehr als ${WORKLOAD_MAX_STATEMENTS} Statements.`);
  }
  return {
    kind: WORKLOAD_FILE_KIND,
    version,
    capturedAt: typeof data.capturedAt === "string" ? data.capturedAt : "",
    connectionName: typeof data.connectionName === "string" ? data.connectionName : "",
    databaseKind: typeof data.databaseKind === "string" ? data.databaseKind : "",
    database: typeof data.database === "string" ? data.database : null,
    statements: data.statements.map(parseStatement),
  };
}

function parseResult(value: unknown, index: number): WorkloadStatementResult {
  if (!isRecord(value) || typeof value.sql !== "string") {
    throw new Error(`Ungültiges Ergebnis bei results[${index}]: SQL-Text fehlt.`);
  }
  const runs = Array.isArray(value.runs) ? value.runs.map(parsePerfRun) : [];
  return {
    sql: value.sql,
    skipped: typeof value.skipped === "string" && value.skipped.length > 0 ? value.skipped : null,
    runs,
    elapsedMs: toNumber(value.elapsedMs) ?? 0,
  };
}

export function parseWorkloadResultFile(text: string): SavedWorkloadResult {
  const data = parseJson(text);
  if (data.kind !== WORKLOAD_RESULT_FILE_KIND) {
    throw new Error(
      "Die Datei ist kein l8db-Workload-Ergebnis. Erwartet wird eine mit l8db gespeicherte Datei (.l8wlresult.json).",
    );
  }
  const version = checkVersion(data);
  if (!Array.isArray(data.results) || data.results.length === 0) {
    throw new Error("Die Datei enthält keine Ergebnisse.");
  }
  return {
    kind: WORKLOAD_RESULT_FILE_KIND,
    version,
    capturedAt: typeof data.capturedAt === "string" ? data.capturedAt : "",
    connectionName: typeof data.connectionName === "string" ? data.connectionName : "",
    databaseKind: typeof data.databaseKind === "string" ? data.databaseKind : "",
    database: typeof data.database === "string" ? data.database : null,
    repeats: toNumber(data.repeats) ?? 1,
    concurrency: toNumber(data.concurrency) ?? 1,
    results: data.results.map(parseResult),
  };
}
