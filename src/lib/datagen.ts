import { listen } from "@tauri-apps/api/event";
import type { SavedConnection } from "@/lib/connections";
import {
  cancelExecution,
  type DatagenColumn,
  type DatagenGenerator,
  type DatagenGeneratorKind,
  type DatagenOutcome,
  type DatagenProgress,
  type DatagenRequest,
  datagenRun,
} from "@/lib/db";
import { isProduction, productionConfirmTexts } from "@/lib/environments";
import { requestSqlConfirmation } from "@/lib/sql-confirmation";
import { effectiveConnectionString } from "@/lib/ssh";
import { finishTask, startTask, updateTask } from "@/lib/tasks";

export const GENERATOR_LABELS: Record<DatagenGeneratorKind, string> = {
  skip: "Auslassen (Standardwert)",
  null: "NULL",
  fixed: "Fester Wert",
  list: "Werteliste",
  pattern: "Muster",
  sequence: "Sequenz",
  sql: "SQL-Ausdruck",
  reference: "Fremdschlüssel",
  email: "E-Mail",
  first_name: "Vorname",
  last_name: "Nachname",
  full_name: "Name",
  username: "Benutzername",
  company: "Firma",
  city: "Stadt",
  street: "Straße",
  postal_code: "PLZ",
  country: "Land",
  phone: "Telefon",
  iban: "IBAN",
  uuid: "UUID",
  url: "URL",
  ip: "IP-Adresse",
  integer: "Ganzzahl",
  decimal: "Dezimalzahl",
  boolean: "Boolesch",
  date: "Datum",
  timestamp: "Zeitstempel",
  time: "Uhrzeit",
  lorem: "Lorem-Text",
  json: "JSON",
};

export const GENERATOR_KINDS = Object.keys(GENERATOR_LABELS) as DatagenGeneratorKind[];

function isoDate(offsetYears: number): string {
  const date = new Date();
  date.setFullYear(date.getFullYear() + offsetYears);
  return date.toISOString().slice(0, 10);
}

export function defaultGenerator(
  kind: DatagenGeneratorKind,
  column: Pick<DatagenColumn, "maxLength" | "enumValues" | "generator">,
): DatagenGenerator {
  const limit = column.maxLength ?? 200;
  switch (kind) {
    case "fixed":
      return { kind, value: "" };
    case "list":
      return { kind, values: column.enumValues.length ? column.enumValues : ["a", "b", "c"] };
    case "pattern":
      return { kind, pattern: "???-#####" };
    case "sequence":
      return { kind, start: 1, step: 1 };
    case "sql":
      return { kind, expression: "" };
    case "reference":
      return column.generator.kind === "reference"
        ? column.generator
        : { kind, schema: "", table: "", column: "" };
    case "integer":
      return { kind, min: 1, max: 1000 };
    case "decimal":
      return { kind, min: 0, max: 1000, scale: 2 };
    case "date":
    case "timestamp":
      return { kind, from: isoDate(-5), to: isoDate(0) };
    case "lorem":
      return { kind, min: Math.min(5, limit), max: Math.min(60, limit) };
    default:
      return { kind } as DatagenGenerator;
  }
}

export function datagenIssues(request: DatagenRequest): string[] {
  const issues: string[] = [];
  if (!Number.isInteger(request.rows) || request.rows < 1)
    issues.push("Zeilenzahl muss mindestens 1 sein.");
  if (request.rows > 50_000_000) issues.push("Höchstens 50 Mio. Zeilen pro Lauf.");
  if (!request.columns.some((column) => column.generator.kind !== "skip"))
    issues.push("Mindestens eine Spalte befüllen.");
  for (const column of request.columns) {
    if (!column.nullable && column.generator.kind === "null" && !request.source)
      issues.push(`${column.name} ist NOT NULL.`);
    if (!column.nullable && column.nullRatio > 0)
      issues.push(`${column.name} ist NOT NULL – NULL-Anteil nicht möglich.`);
    if (column.nullRatio < 0 || column.nullRatio > 1)
      issues.push(`${column.name}: NULL-Anteil 0–100 %.`);
  }
  return issues;
}

export async function confirmDatagenTarget(
  connection: SavedConnection,
  database: string | null,
  request: DatagenRequest,
): Promise<void> {
  if (!isProduction(connection)) return;
  const accepted = await requestSqlConfirmation({
    connection: connection.name,
    database,
    statements: [
      {
        sql: `${request.rows.toLocaleString("de-DE")} Zeilen in ${request.schema}.${request.table}`,
        reason: request.source ? "Maskierte Kopie in Produktion" : "Testdaten in Produktion",
      },
    ],
    confirmTexts: productionConfirmTexts(connection, database),
    title: "In Produktion schreiben?",
    description: "Die Zeilen werden in die Produktionsdatenbank eingefügt.",
    confirmLabel: "Schreiben",
  });
  if (!accepted) throw new Error("Ausführung vom Benutzer abgebrochen.");
}

export async function runDatagen(
  connection: SavedConnection,
  database: string | null,
  request: DatagenRequest,
  onProgress: (rows: number) => void,
  onJob: (id: string) => void,
): Promise<DatagenOutcome> {
  await confirmDatagenTarget(connection, database, request);
  const id = crypto.randomUUID();
  const url = effectiveConnectionString(connection);
  startTask(
    {
      id,
      title: `${request.source ? "Maskierte Kopie" : "Testdaten"} · ${request.schema}.${request.table}`,
      connectionId: connection.id,
      connectionName: connection.name,
      database,
      total: request.rows,
    },
    () => cancelExecution(id),
  );
  onJob(id);
  const unlisten = await listen<DatagenProgress>("datagen-progress", (event) => {
    if (event.payload.jobId !== id) return;
    updateTask(id, { progress: event.payload.rows });
    onProgress(event.payload.rows);
  }).catch(() => () => {});
  try {
    const outcome = await datagenRun(connection.kind, url, request, database ?? undefined, {
      jobId: id,
    });
    finishTask(
      id,
      outcome,
      outcome.cancelled ? "Vom Benutzer abgebrochen." : (outcome.error ?? undefined),
    );
    return outcome;
  } catch (error) {
    finishTask(id, undefined, error);
    throw error;
  } finally {
    unlisten();
  }
}
