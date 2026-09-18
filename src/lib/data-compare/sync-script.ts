import type { DatabaseKind } from "@/lib/db";
import {
  buildInsertStatements,
  type CsvLineEnding,
  identifierStyleForKind,
  qualifiedTarget,
  quoteIdentifier,
  sqlLiteral,
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
  lineEnding?: CsvLineEnding;
}

export interface SyncScriptResult {
  sql: string;
  insertCount: number;
  updateCount: number;
  keys: string[];
}

function sourceOf(row: DataDiffRow, direction: SyncDirection): Record<string, unknown> | null {
  return direction === "left_to_right" ? row.left : row.right;
}

function targetOf(row: DataDiffRow, direction: SyncDirection): Record<string, unknown> | null {
  return direction === "left_to_right" ? row.right : row.left;
}

function insertCategory(direction: SyncDirection): DataDiffCategory {
  return direction === "left_to_right" ? "only_left" : "only_right";
}

function formatKey(row: DataDiffRow, keyColumns: string[]): string {
  return keyColumns.map((column) => `${column}=${String(row.keyValues[column])}`).join(", ");
}

export function buildSyncScript(input: SyncScriptInput): SyncScriptResult {
  const style = identifierStyleForKind(input.kind);
  const eol = input.lineEnding ?? "\n";
  const target = qualifiedTarget(input.target.schema, input.target.table, style);
  const allColumns = [...input.keyColumns, ...input.compareColumns];
  const statements: string[] = [];
  const keys: string[] = [];
  const insertRows: Record<string, unknown>[] = [];
  let updateCount = 0;
  const wanted = insertCategory(input.direction);

  for (const row of input.rows) {
    if (row.category === "equal") continue;
    if (row.category === "changed") {
      const source = sourceOf(row, input.direction);
      const current = targetOf(row, input.direction);
      if (!source || !current) continue;
      const assignments = input.compareColumns
        .filter((column) => !valuesEqual(source[column], current[column]))
        .map(
          (column) => `${quoteIdentifier(column, style)} = ${sqlLiteral(source[column], column)}`,
        );
      if (assignments.length === 0) continue;
      const conditions = [
        ...input.keyColumns.map(
          (column) => `${quoteIdentifier(column, style)} = ${sqlLiteral(current[column], column)}`,
        ),
        ...input.compareColumns.map(
          (column) =>
            `${quoteIdentifier(column, style)} IS NOT DISTINCT FROM ${sqlLiteral(current[column], column)}`,
        ),
      ];
      statements.push(
        `UPDATE ${target}${eol}   SET ${assignments.join(`,${eol}       `)}${eol} WHERE ${conditions.join(`${eol}   AND `)};`,
      );
      updateCount += 1;
      keys.push(formatKey(row, input.keyColumns));
      continue;
    }
    if (row.category !== wanted) continue;
    const source = sourceOf(row, input.direction);
    if (!source) continue;
    insertRows.push(source);
    keys.push(formatKey(row, input.keyColumns));
  }

  const insertSql =
    insertRows.length > 0
      ? buildInsertStatements({
          schema: input.target.schema,
          table: input.target.table,
          columns: allColumns,
          rows: insertRows,
          kind: input.kind,
          lineEnding: eol,
        })
      : "";
  const updateSql = statements.length > 0 ? `${statements.join(eol)}${eol}` : "";
  return {
    sql: `${insertSql}${updateSql}`,
    insertCount: insertRows.length,
    updateCount,
    keys,
  };
}
