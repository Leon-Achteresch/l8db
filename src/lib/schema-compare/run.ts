import type { SavedConnection } from "@/lib/connections";
import {
  beginTransaction,
  commitTransaction,
  compileInvalidObjects,
  executeInTransaction,
  executeQuery,
  executeScript,
  type InvalidCompileOutcome,
  type QueryExecutionOptions,
  rollbackTransaction,
} from "@/lib/db";
import { effectiveConnectionString } from "@/lib/ssh";
import { PRE_TRANSACTION_PHASE, type SyncStatement } from "./script";

export type StepStatus = "pending" | "running" | "ok" | "warning" | "error" | "skipped";

export interface RunStep {
  status: StepStatus;
  message: string | null;
}

export interface RunSummary {
  failed: number;
  warnings: number;
  rolledBack: boolean;
  invalid: InvalidCompileOutcome[];
  dryRun: boolean;
  incomplete: boolean;
  checked: number;
  unchecked: number;
  blocked: boolean;
}

const EXECUTE = { confirmed: true, track: false } as const;

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export type DryRunKind = "rollback" | "precheck";

const TRANSACTIONAL_DDL = new Set<SavedConnection["kind"]>(["postgres", "mssql", "sqlite"]);

export function dryRunKind(kind: SavedConnection["kind"]): DryRunKind | null {
  if (TRANSACTIONAL_DDL.has(kind)) return "rollback";
  if (kind === "oracle") return "precheck";
  return null;
}

const NO_DDL_ROLLBACK = /-YB-|Redshift|QuestDB|CrateDB|materialize|Cockroach/i;

async function serverVersion(
  connection: SavedConnection,
  url: string,
  database: string | undefined,
): Promise<string> {
  const result = await executeQuery(connection.kind, url, "SELECT version()", database, EXECUTE);
  return String(Object.values(result.rows[0] ?? {})[0] ?? "");
}

function rollsBackDdl(version: string): boolean {
  return /^PostgreSQL \d/.test(version) && !NO_DDL_ROLLBACK.test(version);
}

export async function supportsDdlRollback(
  connection: SavedConnection,
  database: string | null,
): Promise<boolean> {
  if (dryRunKind(connection.kind) !== "rollback") return false;
  if (connection.kind !== "postgres") return true;
  return rollsBackDdl(
    await serverVersion(connection, effectiveConnectionString(connection), database ?? undefined),
  );
}

async function precheck(
  connection: SavedConnection,
  url: string,
  database: string | undefined,
  statements: SyncStatement[],
  onStep: (index: number, step: RunStep) => void,
  summary: RunSummary,
  execute: QueryExecutionOptions,
): Promise<void> {
  for (let index = 0; index < statements.length; index++) {
    const checks = statements[index].checks ?? [];
    if (checks.length === 0) continue;
    summary.checked++;
    onStep(index, { status: "running", message: null });
    const problems: string[] = [];
    const unchecked: string[] = [];
    for (const check of checks) {
      try {
        const result = await executeQuery(connection.kind, url, check.sql, database, execute);
        const count = Number(Object.values(result.rows[0] ?? {})[0] ?? 0);
        if (count > 0)
          problems.push(`${check.message} (${count} ${count === 1 ? "Zeile" : "Zeilen"})`);
      } catch (error) {
        unchecked.push(message(error));
      }
    }
    if (problems.length > 0) {
      summary.failed++;
      onStep(index, {
        status: "error",
        message: `Datenprüfung: ${problems.join("; ")}. Die Anweisung würde fehlschlagen.`,
      });
    } else if (unchecked.length > 0) {
      summary.warnings++;
      summary.unchecked++;
      summary.incomplete = true;
      onStep(index, {
        status: "warning",
        message: `Datenprüfung nicht möglich: ${unchecked.join("; ")}`,
      });
    } else {
      onStep(index, { status: "ok", message: "Datenprüfung ohne Befund" });
    }
  }
}

const SEQUENCE_VALUE = /^SELECT setval\(/i;
const NEW_ENUM_VALUE = /SQLSTATE 55P04/;

async function dryRunPostgres(
  connection: SavedConnection,
  url: string,
  database: string | undefined,
  statements: SyncStatement[],
  options: { onStep: (index: number, step: RunStep) => void; stopped: () => boolean },
  summary: RunSummary,
  execute: QueryExecutionOptions,
): Promise<RunSummary> {
  const skipRest = (from: number, message: string | null) => {
    for (let index = from; index < statements.length; index++)
      options.onStep(index, { status: "skipped", message });
  };
  const postgres = connection.kind === "postgres";
  if (postgres) {
    const version = await serverVersion(connection, url, database);
    if (!rollsBackDdl(version))
      throw new Error(
        `Probelauf nicht möglich: Diese Datenbank kann DDL-Anweisungen nicht zuverlässig zurückrollen (${version.slice(0, 80)}). Es wurde nichts ausgeführt.`,
      );
  }
  const tx = await beginTransaction(connection.kind, url, database);
  let index = 0;
  try {
    if (postgres) {
      await executeInTransaction(tx, "SET LOCAL check_function_bodies = false", execute);
      await executeInTransaction(tx, "SET LOCAL lock_timeout = '10s'", execute);
    }
    for (; index < statements.length; index++) {
      if (options.stopped()) {
        summary.incomplete = true;
        skipRest(index, null);
        break;
      }
      if (SEQUENCE_VALUE.test(statements[index].sql)) {
        summary.warnings++;
        options.onStep(index, {
          status: "warning",
          message:
            "Im Probelauf übersprungen: Sequenzwerte lassen sich nicht zurückrollen. Wird beim Ausführen gesetzt.",
        });
        continue;
      }
      options.onStep(index, { status: "running", message: null });
      try {
        await executeInTransaction(tx, statements[index].sql, execute);
        options.onStep(index, { status: "ok", message: null });
      } catch (error) {
        const text = message(error);
        if (options.stopped()) {
          summary.incomplete = true;
          skipRest(index, "Angehalten");
          break;
        }
        if (NEW_ENUM_VALUE.test(text)) {
          summary.warnings++;
          summary.incomplete = true;
          options.onStep(index, {
            status: "warning",
            message: `${text}\nNeue Enum-Werte kann PostgreSQL erst nach dem Festschreiben verwenden. Ab hier lässt sich das Skript im Probelauf nicht prüfen; beim Ausführen werden die Enum-Werte vorab festgeschrieben.`,
          });
        } else {
          summary.failed = 1;
          options.onStep(index, { status: "error", message: text });
        }
        skipRest(index + 1, "Nicht geprüft");
        break;
      }
    }
  } catch (error) {
    summary.failed = 1;
    options.onStep(index, { status: "error", message: message(error) });
    skipRest(index + 1, "Nicht geprüft");
  } finally {
    await rollbackTransaction(tx).catch((error) => {
      throw new Error(`Der Probelauf konnte nicht zurückgerollt werden: ${message(error)}`);
    });
  }
  return summary;
}

export async function runSyncStatements(
  connection: SavedConnection,
  target: { database: string | null; schema: string },
  statements: SyncStatement[],
  options: {
    continueOnError: boolean;
    dryRun?: boolean;
    allowUnchecked?: boolean;
    onStep: (index: number, step: RunStep) => void;
    onJob?: (jobId: string) => void;
    stopped: () => boolean;
  },
): Promise<RunSummary> {
  if (connection.readOnly) throw new Error("Die Zielverbindung ist schreibgeschützt.");
  const url = effectiveConnectionString(connection);
  const database = target.database ?? undefined;
  const summary: RunSummary = {
    failed: 0,
    warnings: 0,
    rolledBack: false,
    invalid: [],
    dryRun: Boolean(options.dryRun),
    incomplete: false,
    checked: 0,
    unchecked: 0,
    blocked: false,
  };
  const execute: QueryExecutionOptions = { ...EXECUTE, onJob: options.onJob };
  const mode = dryRunKind(connection.kind);
  if (options.dryRun) {
    if (mode === "rollback")
      return dryRunPostgres(
        connection,
        url,
        database,
        statements,
        options,
        { ...summary, rolledBack: true },
        execute,
      );
    if (mode !== "precheck")
      throw new Error(
        "Ein Probelauf ist hier nicht möglich: Die Datenbank schreibt DDL-Anweisungen sofort fest.",
      );
    await precheck(connection, url, database, statements, options.onStep, summary, execute);
    statements.forEach((statement, index) => {
      if (!statement.checks?.length) options.onStep(index, { status: "skipped", message: null });
    });
    return summary;
  }
  const skipRest = (from: number, text: string | null = null) => {
    for (let index = from; index < statements.length; index++)
      options.onStep(index, { status: "skipped", message: text });
  };
  if (mode === "precheck") {
    await precheck(connection, url, database, statements, options.onStep, summary, execute);
    if (summary.failed > 0 || (summary.unchecked > 0 && !options.allowUnchecked)) {
      summary.blocked = true;
      statements.forEach((statement, index) => {
        if (!statement.checks?.length)
          options.onStep(index, {
            status: "skipped",
            message: null,
          });
      });
      return summary;
    }
    summary.warnings = 0;
    summary.incomplete = false;
  }

  const scriptError = async (sql: string): Promise<string | null> => {
    try {
      if (connection.kind === "mysql") {
        await executeQuery(connection.kind, url, sql, database, execute);
        return null;
      }
      const results = await executeScript(connection.kind, url, sql, database, execute);
      if (results.length === 0) return "Die Anweisung wurde nicht ausgeführt.";
      return results.find((item) => !item.success)?.error ?? null;
    } catch (cause) {
      return message(cause);
    }
  };

  if (TRANSACTIONAL_DDL.has(connection.kind)) {
    let index = 0;
    for (; statements[index]?.phase === PRE_TRANSACTION_PHASE; index++) {
      options.onStep(index, { status: "running", message: null });
      const error = await scriptError(statements[index].sql);
      options.onStep(
        index,
        error ? { status: "error", message: error } : { status: "ok", message: null },
      );
      if (error) {
        summary.failed = 1;
        skipRest(index + 1);
        return summary;
      }
    }
    const tx = await beginTransaction(connection.kind, url, database);
    try {
      if (connection.kind === "postgres")
        await executeInTransaction(tx, "SET LOCAL check_function_bodies = false", execute);
      for (; index < statements.length; index++) {
        if (options.stopped()) throw new Error("Abgebrochen.");
        options.onStep(index, { status: "running", message: null });
        await executeInTransaction(tx, statements[index].sql, execute);
        options.onStep(index, { status: "ok", message: null });
      }
      await commitTransaction(tx);
    } catch (error) {
      summary.failed = 1;
      summary.rolledBack = true;
      if (index < statements.length)
        options.onStep(index, { status: "error", message: message(error) });
      skipRest(index + 1);
      await rollbackTransaction(tx).catch(() => undefined);
    }
    return summary;
  }

  let plsql = false;
  for (let index = 0; index < statements.length; index++) {
    if (options.stopped()) {
      skipRest(index);
      break;
    }
    const statement = statements[index];
    options.onStep(index, { status: "running", message: null });
    const error = await scriptError(statement.sql);
    plsql ||= statement.plsql;
    if (!error) {
      options.onStep(index, { status: "ok", message: null });
    } else if (/ORA-24344/.test(error)) {
      summary.warnings++;
      options.onStep(index, { status: "warning", message: error });
    } else {
      summary.failed++;
      options.onStep(index, { status: "error", message: error });
      if (!options.continueOnError) {
        skipRest(index + 1);
        break;
      }
    }
  }
  if (plsql && connection.kind === "oracle") {
    const compile = async () =>
      (await compileInvalidObjects(connection.kind, url, database, target.schema)).filter(
        (item) => item.status !== "VALID",
      );
    summary.invalid = await compile();
    if (summary.invalid.length > 0) summary.invalid = await compile();
  }
  return summary;
}
