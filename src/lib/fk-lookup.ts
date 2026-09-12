import type { ForeignKeyInfo } from "@/lib/db";
import { compileContentFilter, type FilterKind } from "@/lib/sql-filter";

export type FkTarget = {
  schema: string;
  table: string;
  keyColumn: string;
};

export const FK_LOOKUP_PAGE_SIZE = 25;

const LABEL_HINT_PATTERN = /(name|title|label|bezeichnung|description|beschreibung|code|email)/i;
const CTID_COLUMN = "__ctid__";

export function resolveFkTarget(
  fk: ForeignKeyInfo,
  currentSchema: string,
  currentTable: string,
): FkTarget | null {
  if (fk.from_schema === currentSchema && fk.from_table === currentTable) {
    return { schema: fk.to_schema, table: fk.to_table, keyColumn: fk.to_column };
  }
  return null;
}

export function outgoingForeignKey(
  foreignKeys: ForeignKeyInfo[] | undefined,
  currentSchema: string,
  currentTable: string,
  column: string,
): ForeignKeyInfo | null {
  if (!foreignKeys) return null;
  return (
    foreignKeys.find(
      (fk) =>
        fk.from_schema === currentSchema &&
        fk.from_table === currentTable &&
        fk.from_column === column,
    ) ?? null
  );
}

export function fkLabelColumns(columns: string[], keyColumn: string, max = 3): string[] {
  const usable = columns.filter((col) => col !== keyColumn && col !== CTID_COLUMN);
  const hinted = usable.filter((col) => LABEL_HINT_PATTERN.test(col));
  const rest = usable.filter((col) => !LABEL_HINT_PATTERN.test(col));
  return [...hinted, ...rest].slice(0, Math.max(0, max));
}

export function escapeSqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

export function quoteSqlIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export function buildFkSearchFilter(
  keyColumn: string,
  labelColumns: string[],
  search: string,
  kind?: FilterKind,
): string {
  const term = search.trim();
  if (term === "") return "";
  const columns = [...new Set([keyColumn, ...labelColumns])];
  const filter = compileContentFilter(columns, term, kind);
  return filter ? (kind === "mongodb" ? filter : `(${filter})`) : "";
}

export function fkPageOffset(page: number, pageSize = FK_LOOKUP_PAGE_SIZE): number {
  return Math.max(0, page) * pageSize;
}

export function hasMoreFkRows(rowCount: number, pageSize = FK_LOOKUP_PAGE_SIZE): boolean {
  return rowCount >= pageSize;
}

export function fkOptionValue(row: Record<string, unknown>, keyColumn: string): string | null {
  const value = row[keyColumn];
  if (value === null || value === undefined) return null;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function fkOptionLabel(
  row: Record<string, unknown>,
  keyColumn: string,
  labelColumns: string[],
): string {
  const parts = labelColumns
    .filter((col) => col !== keyColumn)
    .map((col) => {
      const value = row[col];
      if (value === null || value === undefined) return null;
      const text = typeof value === "object" ? JSON.stringify(value) : String(value);
      return text === "" ? null : text;
    })
    .filter((part): part is string => part !== null);
  if (parts.length === 0) return fkOptionValue(row, keyColumn) ?? "NULL";
  return parts.join(" · ");
}

export function isNullableColumn(
  columns: { name: string; is_nullable: boolean }[] | undefined,
  column: string,
): boolean {
  if (!columns) return false;
  const match = columns.find((col) => col.name === column);
  return match ? match.is_nullable : false;
}
