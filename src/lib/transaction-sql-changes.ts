import type { SavedConnection } from "@/lib/connections";
import type { QueryResult, TransactionTableChanges } from "@/lib/db";
import {
  executeInTransaction,
  listTableColumnsDetailed,
  transactionDatabaseChanges,
} from "@/lib/db";
import { sqlTokens } from "@/lib/sql-safety";
import { splitSqlStatements } from "@/lib/sql-statements";
import { effectiveConnectionString } from "@/lib/ssh";
import {
  type DatabaseChanges,
  type TransactionChange,
  useTransactionStore,
} from "@/lib/transactions";

type Change = Omit<TransactionChange, "id" | "timestamp">;

const IDENT = '(?:"(?:[^"]|"")+"|`(?:[^`]|``)+`|\\[(?:[^\\]]|\\]\\])+\\]|[a-zA-Z_][a-zA-Z_0-9$]*)';
const TARGET = `(${IDENT})(?:\\s*\\.\\s*(${IDENT}))?`;

function identifier(value: string, kind: SavedConnection["kind"]): string {
  if (value.startsWith('"')) return value.slice(1, -1).replaceAll('""', '"');
  if (value.startsWith("`")) return value.slice(1, -1).replaceAll("``", "`");
  if (value.startsWith("[")) return value.slice(1, -1).replaceAll("]]", "]");
  if (kind === "oracle") return value.toUpperCase();
  if (kind === "postgres") return value.toLowerCase();
  return value;
}

function targetParts(first: string, second: string | undefined, kind: SavedConnection["kind"]) {
  return {
    schema: second ? identifier(first, kind) : "",
    table: identifier(second ?? first, kind),
  };
}

function statement(sql: string) {
  return sql.trim().replace(/;\s*$/, "").trim();
}

function withoutComments(sql: string, kind: SavedConnection["kind"]): string | null {
  const comments: [number, number][] = [];
  sqlTokens(sql, kind, comments);
  let out = "";
  let cursor = 0;
  for (const [start, end] of comments) {
    if (/^\/\*[!+]/.test(sql.slice(start, start + 3))) return null;
    out += `${sql.slice(cursor, start)} `;
    cursor = end;
  }
  return out + sql.slice(cursor);
}

function plan(sql: string, kind: SavedConnection["kind"]) {
  const split = splitSqlStatements(sql, kind);
  if (split.unterminated || split.statements.length !== 1) return null;
  const text = withoutComments(split.statements[0].text, kind);
  if (text === null) return null;
  const clean = statement(text);
  if (
    clean.length > 20_000 ||
    /\bON\s+(?:CONFLICT|DUPLICATE\s+KEY)\b/i.test(clean) ||
    (kind === "postgres" && /\bRETURNING\b/i.test(clean))
  )
    return null;
  const insert = new RegExp(
    kind === "postgres"
      ? `^INSERT\\s+INTO\\s+${TARGET}\\s*(?:\\([^)]*\\)\\s*)?(?:VALUES\\s*\\(|DEFAULT\\s+VALUES\\s*$)`
      : `^INSERT\\s+(?:IGNORE\\s+)?INTO\\s+${TARGET}\\s*[\\s\\S]+$`,
    "i",
  ).exec(clean);
  if (insert)
    return {
      type: "insert" as const,
      ...targetParts(insert[1], insert[2], kind),
      target: `${insert[1]}${insert[2] ? `.${insert[2]}` : ""}`,
      clean,
    };
  const remove = new RegExp(
    `^DELETE\\s+(?:FROM\\s+)?${TARGET}(?:\\s+WHERE\\s+([\\s\\S]+))?$`,
    "i",
  ).exec(clean);
  if (remove) {
    if (remove[3] && /\b(ORDER\s+BY|LIMIT|ROWNUM)\b/i.test(remove[3])) return null;
    return {
      type: "delete" as const,
      ...targetParts(remove[1], remove[2], kind),
      target: `${remove[1]}${remove[2] ? `.${remove[2]}` : ""}`,
      clean,
      where: remove[3] ?? null,
    };
  }
  const update = new RegExp(
    `^UPDATE\\s+${TARGET}\\s+SET\\s+([\\s\\S]+?)(?:\\s+WHERE\\s+([\\s\\S]+))?$`,
    "i",
  ).exec(clean);
  if (!update || /\b(FROM|ORDER\s+BY|LIMIT)\b/i.test(update[3])) return null;
  if (!/^[\s\S]+?=[\s\S]+/.test(update[3])) return null;
  return {
    type: "update" as const,
    ...targetParts(update[1], update[2], kind),
    target: `${update[1]}${update[2] ? `.${update[2]}` : ""}`,
    clean,
    assignments: update[3],
    where: update[4] ?? null,
  };
}

function changedColumns(before: Record<string, unknown>, after: Record<string, unknown>) {
  const oldValues: Record<string, unknown> = {};
  const newValues: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(after)) {
    if (JSON.stringify(before[key]) === JSON.stringify(value)) continue;
    oldValues[key] = before[key];
    newValues[key] =
      value == null ? null : typeof value === "string" ? value : JSON.stringify(value);
  }
  return { oldValues, newValues };
}

type ParsedStatement = NonNullable<ReturnType<typeof plan>>;

function quoteColumn(kind: SavedConnection["kind"], column: string): string {
  if (kind === "mysql") return `\`${column.replaceAll("`", "``")}\``;
  if (kind === "mssql") return `[${column.replaceAll("]", "]]")}]`;
  return `"${column.replaceAll('"', '""')}"`;
}

function rowValue(row: Record<string, unknown>, column: string): unknown {
  const actual = Object.keys(row).find((key) => key.toLowerCase() === column.toLowerCase());
  return actual === undefined ? undefined : row[actual];
}

function keyOf(row: Record<string, unknown>, columns: string[]): string | null {
  const values = columns.map((column) => rowValue(row, column));
  return values.some((value) => value == null) ? null : JSON.stringify(values);
}

function sqlLiteral(value: unknown, kind: SavedConnection["kind"]): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "1" : "0";
  const content = (
    kind === "mysql" ? String(value).replaceAll("\\", "\\\\") : String(value)
  ).replaceAll("'", "''");
  return `${kind === "mssql" ? "N" : ""}'${content}'`;
}

function snapshotQuery(
  kind: SavedConnection["kind"],
  target: string,
  where: string | null,
  lock: boolean,
  limit: number,
): string {
  if (kind === "mssql") {
    return `SELECT TOP (${limit}) * FROM ${target}${lock ? " WITH (UPDLOCK, HOLDLOCK)" : ""}${where ? ` WHERE ${where}` : ""}`;
  }
  if (kind === "oracle") {
    if (lock) {
      return `SELECT * FROM ${target} WHERE ${where ? `(${where}\n) AND ` : ""}ROWNUM <= ${limit} FOR UPDATE`;
    }
    return `SELECT * FROM ${target}${where ? ` WHERE ${where}\n` : ""} FETCH FIRST ${limit} ROWS ONLY`;
  }
  return `SELECT * FROM ${target}${where ? ` WHERE ${where}\n` : ""} LIMIT ${limit}${lock && kind === "mysql" ? " FOR UPDATE" : ""}`;
}

function insertedRows(
  before: Record<string, unknown>[],
  after: Record<string, unknown>[],
): Record<string, unknown>[] {
  const existing = new Map<string, number>();
  for (const row of before) {
    const key = JSON.stringify(row);
    existing.set(key, (existing.get(key) ?? 0) + 1);
  }
  return after.filter((row) => {
    const key = JSON.stringify(row);
    const count = existing.get(key) ?? 0;
    if (!count) return true;
    existing.set(key, count - 1);
    return false;
  });
}

function dynamoLiteral(text: string): string | number | boolean | null | undefined {
  const value = text.trim();
  if (/^'(?:''|[^'])*'$/.test(value)) return value.slice(1, -1).replaceAll("''", "'");
  if (/^-?\d+(?:\.\d+)?$/.test(value)) {
    const number = Number(value);
    return Number.isFinite(number) && (!Number.isInteger(number) || Number.isSafeInteger(number))
      ? number
      : undefined;
  }
  if (/^true$/i.test(value)) return true;
  if (/^false$/i.test(value)) return false;
  if (/^null$/i.test(value)) return null;
  return undefined;
}

function dynamoAssignments(sql: string): Record<string, string | null> | null {
  const parts: string[] = [];
  let start = 0;
  let quoted = false;
  for (let index = 0; index < sql.length; index += 1) {
    if (sql[index] === "'") {
      if (quoted && sql[index + 1] === "'") {
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (sql[index] === "," && !quoted) {
      parts.push(sql.slice(start, index));
      start = index + 1;
    }
  }
  if (quoted) return null;
  parts.push(sql.slice(start));
  const values: [string, string | null][] = [];
  for (const part of parts) {
    const match = new RegExp(`^\\s*(${IDENT})\\s*=\\s*([\\s\\S]+?)\\s*$`, "i").exec(part);
    if (!match) return null;
    const value = dynamoLiteral(match[2]);
    if (value === undefined) return null;
    values.push([identifier(match[1], "dynamodb"), value === null ? null : String(value)]);
  }
  return Object.fromEntries(values);
}

function safeDynamoValue(value: unknown): boolean {
  if (typeof value === "number") {
    return Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value));
  }
  if (Array.isArray(value)) return value.every(safeDynamoValue);
  if (value && typeof value === "object") return Object.values(value).every(safeDynamoValue);
  return true;
}

function dynamoInsert(sql: string): { table: string; values: Record<string, unknown> } | null {
  const match = new RegExp(
    `^INSERT\\s+INTO\\s+(${IDENT})\\s+VALUE\\s+(\\{[\\s\\S]*\\})$`,
    "i",
  ).exec(statement(sql));
  if (!match) return null;
  try {
    const json = match[2].replace(/'(?:''|[^'])*'/g, (value) =>
      JSON.stringify(value.slice(1, -1).replaceAll("''", "'")),
    );
    const values: unknown = JSON.parse(json);
    if (!values || Array.isArray(values) || typeof values !== "object" || !safeDynamoValue(values))
      return null;
    return { table: identifier(match[1], "dynamodb"), values: values as Record<string, unknown> };
  } catch {
    return null;
  }
}

async function executeDynamoChanges(
  txId: string,
  sql: string,
  executeOriginal: () => Promise<QueryResult>,
): Promise<{ result: QueryResult; changes: Change[] }> {
  const split = splitSqlStatements(sql, "dynamodb");
  if (split.unterminated || split.statements.length !== 1) {
    return { result: await executeOriginal(), changes: [] };
  }
  const insert = dynamoInsert(sql);
  if (insert) {
    const result = await executeOriginal();
    return {
      result,
      changes: [
        {
          type: "insert",
          table: insert.table,
          rowValues: insert.values,
          fromSql: true,
          planned: true,
        },
      ],
    };
  }
  const update = plan(sql, "dynamodb");
  if (update?.type !== "update" || !update.where) {
    return { result: await executeOriginal(), changes: [] };
  }
  const assignments = dynamoAssignments(update.assignments);
  if (!assignments) return { result: await executeOriginal(), changes: [] };
  let before: Record<string, unknown>[];
  try {
    const selected = await executeInTransaction(
      txId,
      `SELECT * FROM ${update.target} WHERE ${update.where}`,
      { confirmed: true, track: false },
    );
    before = selected.rows;
  } catch {
    return { result: await executeOriginal(), changes: [] };
  }
  const result = await executeOriginal();
  if (before.length > 100) return { result, changes: [] };
  const changes = before.flatMap((row): Change[] => {
    const oldValues: Record<string, unknown> = {};
    const newValues: Record<string, string | null> = {};
    for (const [column, value] of Object.entries(assignments)) {
      const old = rowValue(row, column);
      if (old === value || (old == null && value === null)) continue;
      oldValues[column] = old;
      newValues[column] = value;
    }
    return Object.keys(newValues).length
      ? [
          {
            type: "update",
            table: update.table,
            oldValues,
            newValues,
            fromSql: true,
            planned: true,
          },
        ]
      : [];
  });
  return { result, changes };
}

async function executeSnapshotChanges(
  connection: SavedConnection,
  database: string | null,
  txId: string,
  parsed: ParsedStatement,
  executeOriginal: () => Promise<QueryResult>,
): Promise<{ result: QueryResult; changes: Change[] }> {
  const kind = connection.kind;
  if (!["mysql", "sqlite", "mssql", "oracle"].includes(kind)) {
    return { result: await executeOriginal(), changes: [] };
  }
  const internal = (sql: string) =>
    executeInTransaction(txId, sql, { confirmed: true, track: false });
  const savepoint = `l8db_change_${crypto.randomUUID().replaceAll("-", "")}`;
  const begin = kind === "mssql" ? `SAVE TRANSACTION ${savepoint}` : `SAVEPOINT ${savepoint}`;
  const rollback =
    kind === "mssql" ? `ROLLBACK TRANSACTION ${savepoint}` : `ROLLBACK TO SAVEPOINT ${savepoint}`;
  const release =
    kind === "oracle" || kind === "mssql"
      ? async () => {}
      : () => internal(`RELEASE SAVEPOINT ${savepoint}`);
  const maxSnapshotRows = parsed.type === "insert" ? 1000 : 100;
  let keys: string[] = [];
  if (parsed.type === "update") {
    try {
      let schema = parsed.schema;
      if (!schema && kind === "sqlite") schema = "main";
      if (!schema && kind !== "sqlite") {
        const lookup =
          kind === "mysql"
            ? "SELECT DATABASE() AS l8db_schema"
            : kind === "mssql"
              ? `SELECT OBJECT_SCHEMA_NAME(OBJECT_ID(N'${parsed.target.replaceAll("'", "''")}')) AS l8db_schema`
              : "SELECT SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA') AS l8db_schema FROM DUAL";
        const resolved = await internal(lookup);
        schema = String(Object.values(resolved.rows[0] ?? {})[0] ?? "");
      }
      if (!schema) return { result: await executeOriginal(), changes: [] };
      const columns = await listTableColumnsDetailed(
        kind,
        effectiveConnectionString(connection),
        schema,
        parsed.table,
        database ?? undefined,
      );
      keys = columns.filter((column) => column.is_primary_key).map((column) => column.name);
      if (!keys.length) return { result: await executeOriginal(), changes: [] };
    } catch {
      return { result: await executeOriginal(), changes: [] };
    }
  }
  try {
    await internal(begin);
  } catch {
    return { result: await executeOriginal(), changes: [] };
  }
  let before: Record<string, unknown>[];
  try {
    before = (
      await internal(
        snapshotQuery(
          kind,
          parsed.target,
          parsed.type === "insert" ? null : parsed.where,
          parsed.type !== "insert",
          maxSnapshotRows + 1,
        ),
      )
    ).rows;
    if (before.length > maxSnapshotRows) {
      await release();
      return { result: await executeOriginal(), changes: [] };
    }
  } catch {
    await internal(rollback);
    await release();
    return { result: await executeOriginal(), changes: [] };
  }
  let result: QueryResult;
  try {
    result = await executeOriginal();
  } catch (error) {
    await internal(rollback).catch(() => undefined);
    await release().catch(() => undefined);
    throw error;
  }
  if (parsed.type === "delete") {
    await release().catch(() => undefined);
    return {
      result,
      changes:
        before.length === Number(result.rows_affected)
          ? before.map((row) => ({
              type: "delete",
              schema: parsed.schema,
              table: parsed.table,
              oldValues: row,
              fromSql: true,
            }))
          : [],
    };
  }
  try {
    let after: Record<string, unknown>[];
    if (parsed.type === "insert") {
      after = (await internal(snapshotQuery(kind, parsed.target, null, false, maxSnapshotRows + 1)))
        .rows;
    } else {
      const where = before
        .map(
          (row) =>
            `(${keys.map((column) => `${quoteColumn(kind, column)} = ${sqlLiteral(rowValue(row, column), kind)}`).join(" AND ")})`,
        )
        .join(" OR ");
      after = where
        ? (await internal(snapshotQuery(kind, parsed.target, where, false, maxSnapshotRows + 1)))
            .rows
        : [];
    }
    await release();
    if (after.length > maxSnapshotRows) return { result, changes: [] };
    if (parsed.type === "insert") {
      const added = insertedRows(before, after);
      if (added.length > 100) return { result, changes: [] };
      if (result.rows_affected != null && added.length !== result.rows_affected) {
        return { result, changes: [] };
      }
      return {
        result,
        changes: added.map((row) => ({
          type: "insert",
          schema: parsed.schema,
          table: parsed.table,
          rowValues: row,
          fromSql: true,
        })),
      };
    }
    const matched = new Map(after.map((row) => [keyOf(row, keys), row]));
    if (before.some((row) => !matched.has(keyOf(row, keys))) || after.length !== before.length) {
      return { result, changes: [] };
    }
    const changes = before.flatMap((row): Change[] => {
      const next = matched.get(keyOf(row, keys));
      if (!next) return [];
      const diff = changedColumns(row, next);
      return Object.keys(diff.newValues).length
        ? [{ type: "update", schema: parsed.schema, table: parsed.table, fromSql: true, ...diff }]
        : [];
    });
    if (result.rows_affected != null && changes.length > result.rows_affected) {
      return { result, changes: [] };
    }
    return { result, changes };
  } catch {
    await release().catch(() => undefined);
    return { result, changes: [] };
  }
}

export async function executeWithTransactionChanges(
  connection: SavedConnection,
  database: string | null,
  txId: string,
  sql: string,
  executeOriginal: () => Promise<QueryResult>,
): Promise<{ result: QueryResult; changes: Change[] }> {
  const fallback = async () => ({ result: await executeOriginal(), changes: [] });
  if (connection.kind === "dynamodb") return executeDynamoChanges(txId, sql, executeOriginal);
  const parsed = plan(sql, connection.kind);
  if (!parsed) return fallback();
  if (connection.kind !== "postgres") {
    return executeSnapshotChanges(connection, database, txId, parsed, executeOriginal);
  }
  const savepoint = `l8db_change_${crypto.randomUUID().replaceAll("-", "")}`;
  const internal = (query: string) =>
    executeInTransaction(txId, query, { confirmed: true, track: false });
  await internal(`SAVEPOINT ${savepoint}`);
  let applied = false;
  try {
    let before: Record<string, unknown>[] = [];
    let keys: string[] = [];
    if (parsed.type !== "insert") {
      const selected = await internal(
        `SELECT * FROM ${parsed.target}${parsed.where ? ` WHERE ${parsed.where}\n` : ""} LIMIT 101 FOR UPDATE`,
      );
      before = selected.rows;
      if (before.length > 100) {
        await internal(`RELEASE SAVEPOINT ${savepoint}`);
        return fallback();
      }
      if (before.length > 0 && parsed.type === "update") {
        const relation = parsed.target.replaceAll("'", "''");
        const primaryKey = await internal(
          `SELECT a.attname AS name FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey) WHERE i.indrelid = to_regclass('${relation}') AND i.indisprimary`,
        );
        keys = primaryKey.rows.map((row) => String(row.name));
        if (!keys.length) {
          await internal(`RELEASE SAVEPOINT ${savepoint}`);
          return fallback();
        }
      }
    }
    const result = await internal(`${parsed.clean}\nRETURNING *`);
    applied = true;
    await internal(`RELEASE SAVEPOINT ${savepoint}`);
    let changes: Change[] = [];
    if (parsed.type === "delete") {
      changes = result.rows.map((row) => ({
        type: "delete",
        schema: parsed.schema,
        table: parsed.table,
        oldValues: row,
        fromSql: true,
      }));
    } else if (parsed.type === "insert" && result.rows.length <= 100) {
      changes = result.rows.map((row) => ({
        type: "insert",
        schema: parsed.schema,
        table: parsed.table,
        rowValues: row,
        fromSql: true,
      }));
    } else if (before.length === result.rows.length) {
      const unmatched = [...before];
      changes = result.rows.flatMap((row) => {
        const index = unmatched.findIndex((old) => keys.every((key) => old[key] === row[key]));
        if (index < 0) return [];
        const old = unmatched.splice(index, 1)[0];
        const diff = changedColumns(old, row);
        return Object.keys(diff.newValues).length
          ? [
              {
                type: "update" as const,
                schema: parsed.schema,
                table: parsed.table,
                fromSql: true,
                ...diff,
              },
            ]
          : [];
      });
      if (unmatched.length) changes = [];
    }
    return {
      result: { ...result, columns: [], rows: [] },
      changes,
    };
  } catch (error) {
    if (applied) throw error;
    await internal(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    await internal(`RELEASE SAVEPOINT ${savepoint}`);
    return fallback();
  }
}

export function databaseChangesFrom(tables: TransactionTableChanges[]) {
  const changes: Change[] = [];
  const notes: string[] = [];
  for (const table of tables) {
    const target = { schema: table.schema, table: table.table, fromSql: true };
    if (table.note) notes.push(`${table.schema}.${table.table}: ${table.note}`);
    const rowKey = (row: Record<string, unknown>) =>
      (table.key_columns.length && keyOf(row, table.key_columns)) || crypto.randomUUID();
    const removed = new Map(table.removed.map((row) => [rowKey(row), row]));
    for (const row of table.added) {
      const key = rowKey(row);
      const old = removed.get(key);
      if (!old) {
        changes.push({ type: "insert", ...target, rowValues: row });
        continue;
      }
      removed.delete(key);
      changes.push({
        type: "update",
        ...target,
        rowKey: table.key_columns.map((column) => `${column} ${rowValue(row, column)}`).join(", "),
        ...changedColumns(old, row),
      });
    }
    for (const row of removed.values()) changes.push({ type: "delete", ...target, oldValues: row });
  }
  return { changes, notes };
}

export async function refreshDatabaseChanges(connection: SavedConnection, txId: string) {
  if (connection.kind !== "oracle") return;
  const at = Date.now();
  let next: DatabaseChanges;
  try {
    const { changes, notes } = databaseChangesFrom(await transactionDatabaseChanges(txId));
    next = {
      changes: changes.map((change) => ({ id: crypto.randomUUID(), timestamp: at, ...change })),
      notes,
      at,
    };
  } catch (error) {
    next = { changes: [], notes: [String(error)], at };
  }
  useTransactionStore.getState().setDatabaseChanges(txId, next);
}
