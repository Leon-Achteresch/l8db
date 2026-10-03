import { useConnectionsStore } from "@/lib/connections/store";
import {
  beginTransaction,
  commitTransaction,
  confirmSqlExecution,
  type DatabaseKind,
  executeInTransaction,
  executeQuery,
  rollbackTransaction,
} from "@/lib/db";
import { productionWriteBlock } from "@/lib/environments";
import { operationContext } from "@/lib/operation-context";

export interface TriggerReplacement {
  kind: DatabaseKind;
  connectionString: string;
  database?: string;
  schema: string;
  table: string;
  trigger: string;
  original: string;
  definition: string;
}

export function triggerDropSql(
  kind: DatabaseKind | undefined,
  schema: string,
  table: string,
  trigger: string,
): string {
  const q = (v: string) => `"${v.replace(/"/g, '""')}"`;
  switch (kind) {
    case "postgres":
      return `DROP TRIGGER IF EXISTS ${q(trigger)} ON ${q(schema)}.${q(table)};\n`;
    case "sqlite":
      return `DROP TRIGGER IF EXISTS ${q(schema)}.${q(trigger)};\n`;
    case "mysql":
      return `DROP TRIGGER IF EXISTS \`${schema.replace(/`/g, "``")}\`.\`${trigger.replace(/`/g, "``")}\`;\n`;
    default:
      return "";
  }
}

const MYSQL_NAME = String.raw`(?:\`(?:[^\`]|\`\`)*\`|'(?:[^'\\]|\\.|'')*'|"(?:[^"\\]|\\.|"")*"|[\w$.%-]+)`;
const MYSQL_DEFINER = new RegExp(
  String.raw`^(\s*CREATE\s+)DEFINER\s*=\s*(?:CURRENT_USER(?:\s*\(\s*\))?|${MYSQL_NAME}(?:\s*@\s*${MYSQL_NAME})?)\s+`,
  "i",
);

const MYSQL_QUALIFIED = String.raw`${MYSQL_NAME}(?:\s*\.\s*${MYSQL_NAME})?`;
const MYSQL_TRIGGER_HEAD = new RegExp(
  String.raw`^(\s*CREATE\s+(?:DEFINER\s*=\s*(?:CURRENT_USER(?:\s*\(\s*\))?|${MYSQL_NAME}(?:\s*@\s*${MYSQL_NAME})?)\s+)?TRIGGER\s+(?:IF\s+NOT\s+EXISTS\s+)?)${MYSQL_QUALIFIED}(\s+(?:BEFORE|AFTER)\s+(?:INSERT|UPDATE|DELETE)\s+ON\s+)${MYSQL_QUALIFIED}(\s+FOR\s+EACH\s+ROW)(?:\s+(?:FOLLOWS|PRECEDES)\s+${MYSQL_NAME})?(?=\s)`,
  "i",
);

const mysqlIdent = (value: string) => `\`${value.replace(/`/g, "``")}\``;

export function mysqlTriggerCheckSql(
  definition: string,
  schema: string,
  scratch: string,
): string | null {
  const target = `${mysqlIdent(schema)}.${mysqlIdent(scratch)}`;
  if (!MYSQL_TRIGGER_HEAD.test(definition)) return null;
  return definition.replace(
    MYSQL_TRIGGER_HEAD,
    (_match, head: string, on: string, row: string) => `${head}${target}${on}${target}${row}`,
  );
}

async function checkMysqlTrigger(r: TriggerReplacement, options: { confirmed: boolean }) {
  const scratch = `__l8db_trigger_check_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const check = mysqlTriggerCheckSql(r.definition, r.schema, scratch);
  if (!check) return;
  const table = `${mysqlIdent(r.schema)}.${mysqlIdent(scratch)}`;
  try {
    await executeQuery(
      r.kind,
      r.connectionString,
      `CREATE TABLE ${table} LIKE ${mysqlIdent(r.schema)}.${mysqlIdent(r.table)}`,
      r.database,
      options,
    );
  } catch {
    return;
  }
  try {
    await executeQuery(r.kind, r.connectionString, check, r.database, options);
  } finally {
    await executeQuery(
      r.kind,
      r.connectionString,
      `DROP TABLE IF EXISTS ${table}`,
      r.database,
      options,
    ).catch(() => undefined);
  }
}

export function isDefinerDenied(error: unknown): boolean {
  return /\b1227\b|SET_USER_ID|SET_ANY_DEFINER/i.test(String(error));
}

export function stripMysqlDefiner(sql: string): string {
  return sql.replace(MYSQL_DEFINER, "$1");
}

export function triggerErrorPrefix(kind: DatabaseKind | undefined, drop: string): string {
  return kind === "mysql" || kind === "sqlite" ? "" : drop;
}

export async function replaceTrigger(r: TriggerReplacement): Promise<number> {
  const drop = triggerDropSql(r.kind, r.schema, r.table, r.trigger);
  const started = performance.now();
  if (!drop || r.kind === "postgres") {
    const result = await executeQuery(
      r.kind,
      r.connectionString,
      `${drop}${r.definition}`,
      r.database,
    );
    return result.execution_time_ms;
  }
  const { connectionId } = operationContext({
    kind: r.kind,
    connectionString: r.connectionString,
    database: r.database,
  });
  const connection = useConnectionsStore
    .getState()
    .connections.find((entry) => entry.id === connectionId);
  const blocked = productionWriteBlock(connection, `${drop}${r.definition}`);
  if (blocked) throw new Error(blocked);
  await confirmSqlExecution(r.kind, r.connectionString, `${drop}${r.definition}`, r.database);
  const options = { confirmed: true };
  if (r.kind === "sqlite") {
    const tx = await beginTransaction(r.kind, r.connectionString, r.database);
    try {
      await executeInTransaction(tx, drop, options);
      await executeInTransaction(tx, r.definition, options);
      await commitTransaction(tx);
    } catch (error) {
      try {
        await rollbackTransaction(tx);
      } catch (rollbackError) {
        throw new Error(`${String(error)}\nRollback fehlgeschlagen: ${String(rollbackError)}`);
      }
      throw error;
    }
    return Math.round(performance.now() - started);
  }
  await checkMysqlTrigger(r, options);
  await executeQuery(r.kind, r.connectionString, drop, r.database, options);
  try {
    await executeQuery(r.kind, r.connectionString, r.definition, r.database, options);
  } catch (error) {
    const withoutDefiner = stripMysqlDefiner(r.original);
    let restoredWithoutDefiner = false;
    try {
      await executeQuery(r.kind, r.connectionString, r.original, r.database, options).catch(
        (restoreError: unknown) => {
          if (withoutDefiner === r.original || !isDefinerDenied(restoreError)) throw restoreError;
          restoredWithoutDefiner = true;
          return executeQuery(r.kind, r.connectionString, withoutDefiner, r.database, options);
        },
      );
    } catch (restoreError) {
      throw new Error(
        `${String(error)}\nDer ursprüngliche Trigger konnte nicht wiederhergestellt werden: ${String(restoreError)}\nUrsprüngliche Definition:\n${withoutDefiner}`,
      );
    }
    if (restoredWithoutDefiner) {
      throw new Error(
        `${String(error)}\nDer ursprüngliche Trigger wurde ohne seinen DEFINER wiederhergestellt und läuft jetzt mit den Rechten des aktuellen Benutzers.`,
      );
    }
    throw error;
  }
  return Math.round(performance.now() - started);
}
