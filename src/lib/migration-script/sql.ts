import type { DatabaseKind } from "@/lib/db";
import { quoteIdentifier, type SqlIdentifierStyle } from "@/lib/export";
import type { SchemaSnapshot, SnapshotColumn, SnapshotTable } from "@/lib/schema-snapshot";
import type { MigrationStatementKind } from "./types";

export const STATEMENT_ORDER: Record<MigrationStatementKind, number> = {
  create_table: 1,
  add_column: 2,
  alter_column: 3,
  primary_key: 4,
  drop_column: 5,
  drop_table: 6,
};

export const KIND_LABEL: Record<MigrationStatementKind, string> = {
  create_table: "Tabelle anlegen",
  add_column: "Spalte hinzufügen",
  alter_column: "Spalte ändern",
  primary_key: "Primärschlüssel",
  drop_column: "Spalte entfernen",
  drop_table: "Tabelle entfernen",
};

export function migrationTransactional(kind: DatabaseKind | null | undefined): boolean {
  return kind === "postgres" || kind === "sqlite" || kind === "mssql" || kind === "duckdb";
}

function splitQualified(name: string): { schema: string | null; table: string } {
  const index = name.indexOf(".");
  if (index < 0) return { schema: null, table: name };
  return { schema: name.slice(0, index), table: name.slice(index + 1) };
}

export function quoteQualified(name: string, style: SqlIdentifierStyle): string {
  const parts = splitQualified(name);
  const table = quoteIdentifier(parts.table, style);
  return parts.schema === null ? table : `${quoteIdentifier(parts.schema, style)}.${table}`;
}

export function columnTypeSql(column: SnapshotColumn): string {
  const type = column.data_type.trim();
  if (column.character_maximum_length === null) return type;
  if (type.includes("(")) return type;
  return `${type}(${column.character_maximum_length})`;
}

export function columnDefinitionSql(column: SnapshotColumn, style: SqlIdentifierStyle): string {
  const parts = [quoteIdentifier(column.name, style), columnTypeSql(column)];
  if (column.column_default !== null) parts.push(`DEFAULT ${column.column_default}`);
  if (!column.is_nullable) parts.push("NOT NULL");
  return parts.join(" ");
}

export function findTable(snapshot: SchemaSnapshot, qualifiedName: string): SnapshotTable | null {
  return (
    snapshot.tables.find((table) => `${table.schema}.${table.name}` === qualifiedName) ??
    snapshot.tables.find((table) => table.name === qualifiedName) ??
    null
  );
}

export function findColumn(table: SnapshotTable | null, name: string): SnapshotColumn | null {
  if (!table) return null;
  return table.columns.find((column) => column.name === name) ?? null;
}

export function createTableStatement(table: SnapshotTable, style: SqlIdentifierStyle): string {
  const target = quoteQualified(`${table.schema}.${table.name}`, style);
  const columns = table.columns.map((column) => `  ${columnDefinitionSql(column, style)}`);
  if (table.primary_key.length > 0) {
    const keys = table.primary_key.map((name) => quoteIdentifier(name, style)).join(", ");
    columns.push(`  PRIMARY KEY (${keys})`);
  }
  return `CREATE TABLE ${target} (\n${columns.join(",\n")}\n);`;
}

export function alterColumnStatements(
  target: string,
  before: SnapshotColumn,
  after: SnapshotColumn,
  style: SqlIdentifierStyle,
): { sql: string; dangerous: boolean; note: string | null }[] {
  const column = quoteIdentifier(after.name, style);
  const result: { sql: string; dangerous: boolean; note: string | null }[] = [];
  if (columnTypeSql(before) !== columnTypeSql(after)) {
    result.push({
      sql: `ALTER TABLE ${target} ALTER COLUMN ${column} TYPE ${columnTypeSql(after)};`,
      dangerous: true,
      note: `Typwechsel ${columnTypeSql(before)} → ${columnTypeSql(after)} kann Daten abschneiden; ggf. USING-Ausdruck ergänzen.`,
    });
  }
  if (before.column_default !== after.column_default) {
    result.push({
      sql:
        after.column_default === null
          ? `ALTER TABLE ${target} ALTER COLUMN ${column} DROP DEFAULT;`
          : `ALTER TABLE ${target} ALTER COLUMN ${column} SET DEFAULT ${after.column_default};`,
      dangerous: false,
      note: null,
    });
  }
  if (before.is_nullable !== after.is_nullable) {
    result.push({
      sql: after.is_nullable
        ? `ALTER TABLE ${target} ALTER COLUMN ${column} DROP NOT NULL;`
        : `ALTER TABLE ${target} ALTER COLUMN ${column} SET NOT NULL;`,
      dangerous: !after.is_nullable,
      note: after.is_nullable
        ? null
        : "NOT NULL schlägt fehl, solange die Spalte NULL-Werte enthält.",
    });
  }
  return result;
}
