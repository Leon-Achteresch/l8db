import type { SavedConnection } from "@/lib/connections";
import {
  beginTransaction,
  commitTransaction,
  compileInvalidObjects,
  executeInTransaction,
  executeScript,
  type InvalidCompileOutcome,
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
}

const EXECUTE = { confirmed: true, track: false } as const;

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runSyncStatements(
  connection: SavedConnection,
  target: { database: string | null; schema: string },
  statements: SyncStatement[],
  options: {
    continueOnError: boolean;
    onStep: (index: number, step: RunStep) => void;
    stopped: () => boolean;
  },
): Promise<RunSummary> {
  if (connection.readOnly) throw new Error("Die Zielverbindung ist schreibgeschützt.");
  const url = effectiveConnectionString(connection);
  const database = target.database ?? undefined;
  const summary: RunSummary = { failed: 0, warnings: 0, rolledBack: false, invalid: [] };
  const skipRest = (from: number) => {
    for (let index = from; index < statements.length; index++)
      options.onStep(index, { status: "skipped", message: null });
  };

  const scriptError = async (sql: string): Promise<string | null> => {
    try {
      const results = await executeScript(connection.kind, url, sql, database, EXECUTE);
      if (results.length === 0) return "Die Anweisung wurde nicht ausgeführt.";
      return results.find((item) => !item.success)?.error ?? null;
    } catch (cause) {
      return message(cause);
    }
  };

  if (connection.kind === "postgres") {
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
      await executeInTransaction(tx, "SET LOCAL check_function_bodies = false", EXECUTE);
      for (; index < statements.length; index++) {
        if (options.stopped()) throw new Error("Abgebrochen.");
        options.onStep(index, { status: "running", message: null });
        await executeInTransaction(tx, statements[index].sql, EXECUTE);
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
