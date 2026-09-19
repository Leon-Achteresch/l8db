import { quoteIdentifier, type SqlIdentifierStyle } from "@/lib/export";
import type { SnapshotDiffEntry } from "@/lib/schema-snapshot";
import {
  alterColumnStatements,
  columnDefinitionSql,
  createTableStatement,
  findColumn,
  findTable,
  quoteQualified,
} from "./sql";
import type { MigrationIssue, MigrationScriptInput, MigrationStatement } from "./types";

export function statementsForEntry(
  entry: SnapshotDiffEntry,
  input: MigrationScriptInput,
  style: SqlIdentifierStyle,
  issues: MigrationIssue[],
): Omit<MigrationStatement, "id">[] {
  const target = quoteQualified(entry.table, style);
  if (entry.kind === "table_added") {
    const table = findTable(input.current, entry.table);
    if (!table || table.columns.length === 0) {
      issues.push({
        table: entry.table,
        column: null,
        detail: "Neue Tabelle ohne lesbare Spalten; CREATE TABLE nicht erzeugbar.",
      });
      return [];
    }
    return [
      {
        kind: "create_table",
        table: entry.table,
        column: null,
        sql: createTableStatement(table, style),
        dangerous: false,
        note: null,
      },
    ];
  }

  if (entry.kind === "table_removed") {
    return [
      {
        kind: "drop_table",
        table: entry.table,
        column: null,
        sql: `DROP TABLE ${target};`,
        dangerous: true,
        note: "Entfernt die Tabelle samt Inhalt.",
      },
    ];
  }

  if (entry.kind === "column_added") {
    const column = findColumn(findTable(input.current, entry.table), entry.column ?? "");
    if (!column) {
      issues.push({
        table: entry.table,
        column: entry.column,
        detail: "Spaltendefinition fehlt im aktuellen Stand.",
      });
      return [];
    }
    const risky = !column.is_nullable && column.column_default === null;
    return [
      {
        kind: "add_column",
        table: entry.table,
        column: column.name,
        sql: `ALTER TABLE ${target} ADD COLUMN ${columnDefinitionSql(column, style)};`,
        dangerous: risky,
        note: risky ? "NOT NULL ohne Vorgabewert schlägt bei vorhandenen Zeilen fehl." : null,
      },
    ];
  }

  if (entry.kind === "column_removed") {
    return [
      {
        kind: "drop_column",
        table: entry.table,
        column: entry.column,
        sql: `ALTER TABLE ${target} DROP COLUMN ${quoteIdentifier(entry.column ?? "", style)};`,
        dangerous: true,
        note: "Entfernt die Spalte samt Inhalt.",
      },
    ];
  }

  if (entry.kind === "column_changed") {
    const before = findColumn(findTable(input.base, entry.table), entry.column ?? "");
    const after = findColumn(findTable(input.current, entry.table), entry.column ?? "");
    if (!before || !after) {
      issues.push({
        table: entry.table,
        column: entry.column,
        detail: "Spalte in einem der Stände nicht auffindbar.",
      });
      return [];
    }
    const changes = alterColumnStatements(target, before, after, style);
    if (changes.length === 0) {
      issues.push({
        table: entry.table,
        column: entry.column,
        detail: "Änderung ist nicht als ALTER COLUMN abbildbar.",
      });
      return [];
    }
    return changes.map((change) => ({
      kind: "alter_column" as const,
      table: entry.table,
      column: entry.column,
      sql: change.sql,
      dangerous: change.dangerous,
      note: change.note,
    }));
  }

  issues.push({
    table: entry.table,
    column: entry.column,
    detail: `Primärschlüsselwechsel (${entry.before ?? "—"} → ${entry.after ?? "—"}) benötigt den Constraint-Namen und muss von Hand ergänzt werden.`,
  });
  return [];
}
