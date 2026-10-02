import {
  isDefinerDenied,
  stripMysqlDefiner,
} from "@/features/triggers/trigger-view/replace-trigger";
import { useConnectionsStore } from "@/lib/connections/store";
import { confirmSqlExecution, type DatabaseKind, executeQuery, validateSql } from "@/lib/db";
import { productionWriteBlock } from "@/lib/environments";
import { operationContext } from "@/lib/operation-context";

export interface RoutineEdit {
  kind: DatabaseKind;
  connectionString: string;
  database?: string;
  schema?: string;
  original: string;
  definition: string;
}

const MYSQL_NAME = String.raw`(?:\`(?:[^\`]|\`\`)*\`|"(?:[^"]|"")*"|[\w$]+)`;
const MYSQL_USER = String.raw`(?:\`(?:[^\`]|\`\`)*\`|'(?:[^'\\]|\\.|'')*'|"(?:[^"\\]|\\.|"")*"|[\w$.%-]+)`;
const MYSQL_ROUTINE_HEAD = new RegExp(
  String.raw`^(\s*CREATE\s+(?:DEFINER\s*=\s*(?:CURRENT_USER(?:\s*\(\s*\))?|${MYSQL_USER}(?:\s*@\s*${MYSQL_USER})?)\s+)?(?:AGGREGATE\s+)?)(FUNCTION|PROCEDURE)(\s+(?:IF\s+NOT\s+EXISTS\s+)?)(${MYSQL_NAME})(?:\s*\.\s*(${MYSQL_NAME}))?`,
  "i",
);
const CLICKHOUSE_FUNCTION_HEAD =
  /^(\s*CREATE\s+)(FUNCTION\s+)(`(?:[^`\\]|\\.|``)*`|"(?:[^"\\]|\\.|"")*"|\w+)/i;

const mysqlIdent = (value: string) => `\`${value.replace(/`/g, "``")}\``;
const mysqlString = (value: string) => `'${value.replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;

const ROUTINE_PRIVILEGES: Record<string, string> = {
  execute: "EXECUTE",
  "alter routine": "ALTER ROUTINE",
};

export function mysqlRoutineGrantStatements(
  rows: Record<string, unknown>[],
  type: "FUNCTION" | "PROCEDURE",
  target: string,
): string[] {
  return rows.flatMap((row) => {
    const flags = String(row.privileges ?? "")
      .split(",")
      .map((flag) => flag.trim().toLowerCase())
      .filter(Boolean);
    const privileges = flags.flatMap((flag) => ROUTINE_PRIVILEGES[flag] ?? []);
    if (!privileges.length) return [];
    const grantee = `${mysqlString(String(row.user ?? ""))}@${mysqlString(String(row.host ?? ""))}`;
    const option = flags.includes("grant") ? " WITH GRANT OPTION" : "";
    return [`GRANT ${privileges.join(", ")} ON ${type} ${target} TO ${grantee}${option}`];
  });
}

function unquote(name: string): string {
  const quote = name[0];
  if ((quote === "`" || quote === '"') && name.endsWith(quote) && name.length > 1)
    return name.slice(1, -1).replaceAll(`${quote}${quote}`, quote);
  return name;
}

interface MysqlRoutineHead {
  type: "FUNCTION" | "PROCEDURE";
  schema: string | null;
  name: string;
  rename: (target: string) => string;
}

export function mysqlRoutineHead(sql: string): MysqlRoutineHead | null {
  const match = MYSQL_ROUTINE_HEAD.exec(sql);
  if (!match) return null;
  const [whole, head, type, gap, first, second] = match;
  return {
    type: type.toUpperCase() as MysqlRoutineHead["type"],
    schema: second ? unquote(first) : null,
    name: unquote(second ?? first),
    rename: (target) => `${head}${type}${gap}${target}${sql.slice(whole.length)}`,
  };
}

export interface MysqlRoutinePlan {
  check: string;
  dropCheck: string;
  drop: string | null;
  create: string;
  restore: string | null;
  grants: string;
  target: string;
  type: "FUNCTION" | "PROCEDURE";
}

export function mysqlRoutinePlan(edit: RoutineEdit, scratch: string): MysqlRoutinePlan | null {
  const head = mysqlRoutineHead(edit.definition);
  if (!head) return null;
  const schema = head.schema ?? edit.schema ?? null;
  const qualify = (name: string) =>
    schema ? `${mysqlIdent(schema)}.${mysqlIdent(name)}` : mysqlIdent(name);
  const target = qualify(head.name);
  const scratchTarget = qualify(scratch);
  const original = mysqlRoutineHead(edit.original);
  const originalSchema = original ? (original.schema ?? edit.schema ?? null) : null;
  const sameObject =
    original !== null &&
    original.type === head.type &&
    originalSchema === schema &&
    original.name.toLowerCase() === head.name.toLowerCase();
  return {
    check: head.rename(scratchTarget),
    dropCheck: `DROP ${head.type} IF EXISTS ${scratchTarget}`,
    drop: sameObject ? `DROP ${head.type} IF EXISTS ${target}` : null,
    create: head.rename(target),
    restore: sameObject && original ? original.rename(target) : null,
    grants: `SELECT User AS user, Host AS host, CAST(Proc_priv AS CHAR) AS privileges FROM mysql.procs_priv WHERE Db = ${schema === null ? "DATABASE()" : mysqlString(schema)} AND Routine_name = ${mysqlString(head.name)} AND Routine_type = '${head.type}'`,
    target,
    type: head.type,
  };
}

export function clickhouseReplaceSql(edit: RoutineEdit): string {
  const head = CLICKHOUSE_FUNCTION_HEAD.exec(edit.definition);
  const original = CLICKHOUSE_FUNCTION_HEAD.exec(edit.original);
  if (!head || !original || unquote(head[3]) !== unquote(original[3])) return edit.definition;
  return edit.definition.replace(CLICKHOUSE_FUNCTION_HEAD, "$1OR REPLACE $2$3");
}

function scratchName(): string {
  return `__l8db_routine_check_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

async function checkMysqlPlan(edit: RoutineEdit, plan: MysqlRoutinePlan) {
  const options = { confirmed: true };
  await executeQuery(edit.kind, edit.connectionString, plan.check, edit.database, options);
  await executeQuery(
    edit.kind,
    edit.connectionString,
    plan.dropCheck,
    edit.database,
    options,
  ).catch(() => undefined);
}

export async function checkRoutine(edit: RoutineEdit): Promise<void> {
  const plan = edit.kind === "mysql" ? mysqlRoutinePlan(edit, scratchName()) : null;
  if (plan) return checkMysqlPlan(edit, plan);
  await validateSql(edit.kind, edit.connectionString, edit.definition, edit.database);
}

async function restoreMysqlRoutine(
  edit: RoutineEdit,
  restore: string,
  error: unknown,
): Promise<unknown> {
  const options = { confirmed: true };
  const withoutDefiner = stripMysqlDefiner(restore);
  let restoredWithoutDefiner = false;
  try {
    await executeQuery(edit.kind, edit.connectionString, restore, edit.database, options).catch(
      (restoreError: unknown) => {
        if (withoutDefiner === restore || !isDefinerDenied(restoreError)) throw restoreError;
        restoredWithoutDefiner = true;
        return executeQuery(
          edit.kind,
          edit.connectionString,
          withoutDefiner,
          edit.database,
          options,
        );
      },
    );
  } catch (restoreError) {
    throw new Error(
      `${String(error)}\nDas ursprüngliche Objekt konnte nicht wiederhergestellt werden: ${String(restoreError)}\nUrsprüngliche Definition:\n${withoutDefiner}`,
    );
  }
  return restoredWithoutDefiner
    ? new Error(
        `${String(error)}\nDas ursprüngliche Objekt wurde ohne seinen DEFINER wiederhergestellt und läuft jetzt mit den Rechten des aktuellen Benutzers.`,
      )
    : error;
}

async function regrantMysqlRoutine(edit: RoutineEdit, grants: string[], failure: unknown) {
  const failed: string[] = [];
  for (const grant of grants) {
    try {
      await executeQuery(edit.kind, edit.connectionString, grant, edit.database, {
        confirmed: true,
        track: false,
      });
    } catch (error) {
      failed.push(`${grant}; -- ${String(error)}`);
    }
  }
  if (!failed.length) return;
  const message = `Die Rechte auf dem Objekt konnten nicht vollständig wiederhergestellt werden:\n${failed.join("\n")}`;
  throw new Error(failure ? `${String(failure)}\n${message}` : message);
}

export interface RoutineApplyResult {
  time: number;
  warning?: string;
}

export async function applyRoutine(edit: RoutineEdit): Promise<RoutineApplyResult> {
  const plan = edit.kind === "mysql" ? mysqlRoutinePlan(edit, scratchName()) : null;
  if (!plan?.drop) {
    const sql =
      edit.kind === "clickhouse" ? clickhouseReplaceSql(edit) : (plan?.create ?? edit.definition);
    const result = await executeQuery(edit.kind, edit.connectionString, sql, edit.database);
    return { time: result.execution_time_ms };
  }
  const started = performance.now();
  const script = `${plan.drop};\n${plan.create}`;
  const { connectionId } = operationContext({
    kind: edit.kind,
    connectionString: edit.connectionString,
    database: edit.database,
  });
  const connection = useConnectionsStore
    .getState()
    .connections.find((entry) => entry.id === connectionId);
  const blocked = productionWriteBlock(connection, script);
  if (blocked) throw new Error(blocked);
  await confirmSqlExecution(edit.kind, edit.connectionString, script, edit.database);
  const options = { confirmed: true };
  await checkMysqlPlan(edit, plan);
  let grants: string[] = [];
  let warning: string | undefined;
  try {
    const result = await executeQuery(
      edit.kind,
      edit.connectionString,
      plan.grants,
      edit.database,
      { confirmed: true, track: false },
    );
    grants = mysqlRoutineGrantStatements(result.rows, plan.type, plan.target);
  } catch {
    warning =
      "Die Rechte auf dem Objekt konnten nicht gelesen werden (mysql.procs_priv). Prüfe, ob GRANTs auf diesem Objekt neu vergeben werden müssen.";
  }
  await executeQuery(edit.kind, edit.connectionString, plan.drop, edit.database, options);
  let failure: unknown = null;
  try {
    await executeQuery(edit.kind, edit.connectionString, plan.create, edit.database, options);
  } catch (error) {
    if (!plan.restore) throw error;
    failure = await restoreMysqlRoutine(edit, plan.restore, error);
  }
  await regrantMysqlRoutine(edit, grants, failure);
  if (failure) throw failure;
  return { time: Math.round(performance.now() - started), warning };
}
