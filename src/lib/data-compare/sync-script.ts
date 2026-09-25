import type { DatabaseKind } from "@/lib/db";
import {
  type CsvLineEnding,
  identifierStyleForKind,
  qualifiedTarget,
  quoteIdentifier,
  sqlLiteral,
  UnsupportedValueError,
} from "@/lib/export";
import { valuesEqual } from "./compare";
import type { DataDiffCategory, DataDiffRow } from "./types";

export type SyncDirection = "left_to_right" | "right_to_left";

export interface SyncScriptInput {
  rows: DataDiffRow[];
  direction: SyncDirection;
  target: { schema?: string | null; table: string };
  keyColumns: string[];
  compareColumns: string[];
  kind?: DatabaseKind | null;
  columnTypes?: Record<string, string>;
  includeDeletes?: boolean;
  lineEnding?: CsvLineEnding;
}

export interface SyncScriptResult {
  sql: string;
  insertCount: number;
  updateCount: number;
  deleteCount: number;
  keys: string[];
}

const BINARY_TYPE = /binary|blob|bytea|image|raw/i;
const TEMPORAL_TYPE = /date|time/i;
const INEXACT_TYPE = /float|real|double/i;
const UNCOMPARABLE_TYPE: Partial<Record<DatabaseKind, RegExp>> = {
  mssql: /^(n?text|image|xml|geography|geometry|sql_variant)$/i,
  mysql: /json|geometry|point|linestring|polygon/i,
};

function sourceOf(row: DataDiffRow, direction: SyncDirection): Record<string, unknown> | null {
  return direction === "left_to_right" ? row.left : row.right;
}

function targetOf(row: DataDiffRow, direction: SyncDirection): Record<string, unknown> | null {
  return direction === "left_to_right" ? row.right : row.left;
}

function insertCategory(direction: SyncDirection): DataDiffCategory {
  return direction === "left_to_right" ? "only_left" : "only_right";
}

function deleteCategory(direction: SyncDirection): DataDiffCategory {
  return direction === "left_to_right" ? "only_right" : "only_left";
}

function formatKey(row: DataDiffRow, keyColumns: string[]): string {
  return keyColumns.map((column) => `${column}=${String(row.keyValues[column])}`).join(", ");
}

function quoteText(text: string, kind: DatabaseKind | null | undefined): string {
  const escaped = text.split("'").join("''");
  if (kind === "mysql") return `'${escaped.split("\\").join("\\\\")}'`;
  if (kind === "mssql") return `N'${escaped}'`;
  return `'${escaped}'`;
}

export function dialectLiteral(
  value: unknown,
  column: string,
  kind: DatabaseKind | null | undefined,
  type = "",
): string {
  if (!kind || kind === "postgres") return sqlLiteral(value, column);
  if (value === null || value === undefined) return "NULL";
  if (/json/i.test(type)) return quoteText(JSON.stringify(value), kind);
  if (typeof value === "boolean") return value ? "1" : "0";
  if (typeof value === "string" && BINARY_TYPE.test(type) && /^\\x([0-9a-f]{2})*$/i.test(value)) {
    const hex = value.slice(2).toUpperCase();
    if (kind === "mssql") return hex ? `0x${hex}` : "0x";
    if (kind === "oracle") return `HEXTORAW('${hex}')`;
    return `X'${hex}'`;
  }
  if (typeof value === "string") {
    if (value.includes("\u0000"))
      throw new UnsupportedValueError(column, "Text enthält ein Nullbyte.");
    if (kind === "mssql" && TEMPORAL_TYPE.test(type)) {
      return quoteText(
        value.replace(/^(\d{4}-\d{2}-\d{2}) (?=\d)/, "$1T").replace(/(\.\d{7})\d+/, "$1"),
        kind,
      );
    }
    return quoteText(value, kind);
  }
  if (typeof value === "object" && !(value instanceof Date) && !ArrayBuffer.isView(value)) {
    return quoteText(JSON.stringify(value), kind);
  }
  const literal = sqlLiteral(value, column);
  return literal.startsWith("'")
    ? quoteText(literal.slice(1, -1).split("''").join("'"), kind)
    : literal;
}

function nullSafeEquals(
  column: string,
  literal: string,
  kind: DatabaseKind | null | undefined,
): string {
  if (!kind || kind === "postgres") return `${column} IS NOT DISTINCT FROM ${literal}`;
  if (literal === "NULL") return `${column} IS NULL`;
  if (kind === "mysql") return `${column} <=> ${literal}`;
  if (kind === "sqlite") return `${column} IS ${literal}`;
  return `${column} = ${literal}`;
}

function checkable(kind: DatabaseKind | null | undefined, type: string): boolean {
  if (!kind || kind === "postgres" || kind === "sqlite") return true;
  return !INEXACT_TYPE.test(type) && !UNCOMPARABLE_TYPE[kind]?.test(type);
}

export function buildSyncScript(input: SyncScriptInput): SyncScriptResult {
  const kind = input.kind;
  const style = identifierStyleForKind(kind);
  const eol = input.lineEnding ?? "\n";
  const target = qualifiedTarget(input.target.schema, input.target.table, style);
  const typeOf = (column: string) => input.columnTypes?.[column] ?? "";
  const literal = (value: unknown, column: string) =>
    dialectLiteral(value, column, kind, typeOf(column));
  const name = (column: string) => quoteIdentifier(column, style);
  const keyCondition = (row: Record<string, unknown>) =>
    input.keyColumns.map((column) => `${name(column)} = ${literal(row[column], column)}`);
  const allColumns = [...input.keyColumns, ...input.compareColumns];
  const deletes: string[] = [];
  const inserts: string[] = [];
  const updates: string[] = [];
  const keys: string[] = [];

  for (const row of input.rows) {
    if (row.category === "equal") continue;
    if (row.category === "changed") {
      const source = sourceOf(row, input.direction);
      const current = targetOf(row, input.direction);
      if (!source || !current) continue;
      const assignments = input.compareColumns
        .filter((column) => !valuesEqual(source[column], current[column]))
        .map((column) => `${name(column)} = ${literal(source[column], column)}`);
      if (assignments.length === 0) continue;
      const conditions = [
        ...keyCondition(current),
        ...input.compareColumns
          .filter((column) => checkable(kind, typeOf(column)))
          .map((column) => nullSafeEquals(name(column), literal(current[column], column), kind)),
      ];
      updates.push(
        `UPDATE ${target}${eol}   SET ${assignments.join(`,${eol}       `)}${eol} WHERE ${conditions.join(`${eol}   AND `)};`,
      );
      keys.push(formatKey(row, input.keyColumns));
      continue;
    }
    if (row.category === deleteCategory(input.direction)) {
      const current = targetOf(row, input.direction);
      if (!input.includeDeletes || !current) continue;
      deletes.push(`DELETE FROM ${target} WHERE ${keyCondition(current).join(" AND ")};`);
      keys.push(formatKey(row, input.keyColumns));
      continue;
    }
    if (row.category !== insertCategory(input.direction)) continue;
    const source = sourceOf(row, input.direction);
    if (!source) continue;
    const values = allColumns.map((column) => literal(source[column], column)).join(", ");
    inserts.push(`INSERT INTO ${target} (${allColumns.map(name).join(", ")}) VALUES (${values})`);
    keys.push(formatKey(row, input.keyColumns));
  }

  const insertCount = inserts.length;
  let insertBlock = inserts.map((statement) => `${statement};`);
  if (kind === "mssql" && insertCount > 0) {
    const object = target.split("'").join("''");
    const identity = (state: string) =>
      `IF OBJECTPROPERTY(OBJECT_ID(N'${object}'), 'TableHasIdentity') = 1 SET IDENTITY_INSERT ${target} ${state}`;
    insertBlock = [`${[identity("ON"), ...inserts, identity("OFF")].join(eol)};`];
  }
  const statements = [...deletes, ...insertBlock, ...updates];
  return {
    sql: statements.length > 0 ? `${statements.join(eol)}${eol}` : "",
    insertCount,
    updateCount: updates.length,
    deleteCount: deletes.length,
    keys,
  };
}
