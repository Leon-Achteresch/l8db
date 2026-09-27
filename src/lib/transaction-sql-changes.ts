import type { SavedConnection } from "@/lib/connections";
import type { QueryResult } from "@/lib/db";
import { executeInTransaction } from "@/lib/db";
import { splitSqlStatements } from "@/lib/sql-statements";
import type { TransactionChange } from "@/lib/transactions";

type Change = Omit<TransactionChange, "id" | "timestamp">;

const IDENT = '(?:"(?:[^"]|"")+"|[a-zA-Z_][a-zA-Z_0-9$]*)';
const TARGET = `(${IDENT})(?:\\s*\\.\\s*(${IDENT}))?`;

function identifier(value: string): string {
  return value.startsWith('"') ? value.slice(1, -1).replaceAll('""', '"') : value.toLowerCase();
}

function targetParts(first: string, second?: string) {
  return { schema: second ? identifier(first) : "", table: identifier(second ?? first) };
}

function statement(sql: string) {
  return sql.trim().replace(/;\s*$/, "").trim();
}

function plan(sql: string) {
  const split = splitSqlStatements(sql, "postgres");
  if (split.unterminated || split.statements.length !== 1) return null;
  const clean = statement(sql);
  if (clean.length > 20_000 || /\b(RETURNING|ON\s+CONFLICT)\b/i.test(clean)) return null;
  const insert = new RegExp(
    `^INSERT\\s+INTO\\s+${TARGET}\\s*(?:\\([^)]*\\)\\s*)?(?:VALUES\\s*\\(|DEFAULT\\s+VALUES\\s*$)`,
    "i",
  ).exec(clean);
  if (insert) return { type: "insert" as const, ...targetParts(insert[1], insert[2]), clean };
  const update = new RegExp(
    `^UPDATE\\s+${TARGET}\\s+SET\\s+([\\s\\S]+?)(?:\\s+WHERE\\s+([\\s\\S]+))?$`,
    "i",
  ).exec(clean);
  if (!update || /\b(FROM|ORDER\s+BY|LIMIT)\b/i.test(update[3])) return null;
  if (!/^[\s\S]+?=[\s\S]+/.test(update[3])) return null;
  return {
    type: "update" as const,
    ...targetParts(update[1], update[2]),
    target: `${update[1]}${update[2] ? `.${update[2]}` : ""}`,
    clean,
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

export async function executeWithTransactionChanges(
  connection: SavedConnection,
  txId: string,
  sql: string,
  executeOriginal: () => Promise<QueryResult>,
): Promise<{ result: QueryResult; changes: Change[] }> {
  const fallback = async () => ({ result: await executeOriginal(), changes: [] });
  if (connection.kind !== "postgres") return fallback();
  const parsed = plan(sql);
  if (!parsed) return fallback();
  const savepoint = `l8db_change_${crypto.randomUUID().replaceAll("-", "")}`;
  const internal = (query: string) =>
    executeInTransaction(txId, query, { confirmed: true, track: false });
  await internal(`SAVEPOINT ${savepoint}`);
  let applied = false;
  try {
    let before: Record<string, unknown>[] = [];
    let keys: string[] = [];
    if (parsed.type === "update") {
      const selected = await internal(
        `SELECT * FROM ${parsed.target}${parsed.where ? ` WHERE ${parsed.where}` : ""} LIMIT 101 FOR UPDATE`,
      );
      before = selected.rows;
      if (before.length > 100) {
        await internal(`RELEASE SAVEPOINT ${savepoint}`);
        return fallback();
      }
      if (before.length > 0) {
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
    const result = await internal(`${parsed.clean} RETURNING *`);
    applied = true;
    await internal(`RELEASE SAVEPOINT ${savepoint}`);
    let changes: Change[] = [];
    if (parsed.type === "insert" && result.rows.length <= 100) {
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
