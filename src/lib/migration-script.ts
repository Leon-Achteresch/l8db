import type { DatabaseKind } from "@/lib/db";
import { identifierStyleForKind, quoteIdentifier, type SqlIdentifierStyle } from "@/lib/export";
import type {
  SchemaSnapshot,
  SnapshotColumn,
  SnapshotDiffEntry,
  SnapshotTable,
} from "@/lib/schema-snapshot";

export type MigrationStatementKind =
  | "create_table"
  | "add_column"
  | "alter_column"
  | "primary_key"
  | "drop_column"
  | "drop_table";

export interface MigrationStatement {
  id: string;
  kind: MigrationStatementKind;
  table: string;
  column: string | null;
  sql: string;
  dangerous: boolean;
  note: string | null;
}

export interface MigrationIssue {
  table: string;
  column: string | null;
  detail: string;
}

export interface MigrationScript {
  statements: MigrationStatement[];
  issues: MigrationIssue[];
  transactional: boolean;
  dangerousCount: number;
  skippedDangerous: number;
  sql: string;
}

export interface MigrationScriptInput {
  kind: DatabaseKind | null;
  base: SchemaSnapshot;
  current: SchemaSnapshot;
  entries: SnapshotDiffEntry[];
  includeDangerous?: boolean;
  generatedAt?: Date;
}

const STATEMENT_ORDER: Record<MigrationStatementKind, number> = {
  create_table: 1,
  add_column: 2,
  alter_column: 3,
  primary_key: 4,
  drop_column: 5,
  drop_table: 6,
};

const KIND_LABEL: Record<MigrationStatementKind, string> = {
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

function quoteQualified(name: string, style: SqlIdentifierStyle): string {
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

function columnDefinitionSql(column: SnapshotColumn, style: SqlIdentifierStyle): string {
  const parts = [quoteIdentifier(column.name, style), columnTypeSql(column)];
  if (column.column_default !== null) parts.push(`DEFAULT ${column.column_default}`);
  if (!column.is_nullable) parts.push("NOT NULL");
  return parts.join(" ");
}

function findTable(snapshot: SchemaSnapshot, qualifiedName: string): SnapshotTable | null {
  return (
    snapshot.tables.find((table) => `${table.schema}.${table.name}` === qualifiedName) ??
    snapshot.tables.find((table) => table.name === qualifiedName) ??
    null
  );
}

function findColumn(table: SnapshotTable | null, name: string): SnapshotColumn | null {
  if (!table) return null;
  return table.columns.find((column) => column.name === name) ?? null;
}

function createTableStatement(table: SnapshotTable, style: SqlIdentifierStyle): string {
  const target = quoteQualified(`${table.schema}.${table.name}`, style);
  const columns = table.columns.map((column) => `  ${columnDefinitionSql(column, style)}`);
  if (table.primary_key.length > 0) {
    const keys = table.primary_key.map((name) => quoteIdentifier(name, style)).join(", ");
    columns.push(`  PRIMARY KEY (${keys})`);
  }
  return `CREATE TABLE ${target} (\n${columns.join(",\n")}\n);`;
}

function alterColumnStatements(
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

function statementsForEntry(
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

function commentLines(text: string): string[] {
  return text.split("\n").map((line) => `-- ${line}`);
}

function renderScript(
  script: Omit<MigrationScript, "sql">,
  input: MigrationScriptInput,
  generatedAt: Date,
): string {
  const scope = input.base.scope;
  const lines: string[] = [
    ...commentLines("Migrationsskript (erzeugt aus Metadaten-Snapshot-Vergleich)"),
    ...commentLines(
      `Von Snapshot ${input.base.captured_at} nach Stand ${input.current.captured_at}`,
    ),
    ...commentLines(
      `Umfang: ${scope.connection_name} · ${scope.database ?? "—"} · Schema ${scope.schema}`,
    ),
    ...commentLines(`Erzeugt: ${generatedAt.toISOString()}`),
    ...commentLines(
      `Anweisungen: ${script.statements.length} · gefährlich: ${script.dangerousCount}`,
    ),
  ];
  if (script.skippedDangerous > 0) {
    lines.push(
      ...commentLines(
        `${script.skippedDangerous} gefährliche Anweisungen wurden auf Wunsch ausgelassen.`,
      ),
    );
  }
  if (!script.transactional) {
    lines.push(
      ...commentLines(
        "Diese Datenbank kennt kein transaktionales DDL; die Klammer BEGIN/COMMIT entfällt.",
      ),
    );
  }
  lines.push("");

  if (script.transactional) {
    lines.push("BEGIN;", "");
  }

  script.statements.forEach((statement, index) => {
    lines.push(
      `-- ${index + 1}. ${KIND_LABEL[statement.kind]}: ${statement.table}${statement.column ? `.${statement.column}` : ""}`,
    );
    if (statement.dangerous) {
      lines.push(`-- ACHTUNG (gefährlich): ${statement.note ?? "Prüfen vor dem Ausführen."}`);
    } else if (statement.note) {
      lines.push(`-- Hinweis: ${statement.note}`);
    }
    lines.push(statement.sql, "");
  });

  if (script.statements.length === 0) {
    lines.push(...commentLines("Keine abbildbaren Unterschiede gefunden."), "");
  }

  if (script.transactional) {
    lines.push("COMMIT;", "");
  }

  if (script.issues.length > 0) {
    lines.push(...commentLines("Nicht abbildbare Unterschiede:"));
    for (const issue of script.issues) {
      lines.push(
        ...commentLines(
          `  ${issue.table}${issue.column ? `.${issue.column}` : ""}: ${issue.detail}`,
        ),
      );
    }
    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

export function buildMigrationScript(input: MigrationScriptInput): MigrationScript {
  const style = identifierStyleForKind(input.kind);
  const includeDangerous = input.includeDangerous ?? true;
  const generatedAt = input.generatedAt ?? new Date();
  const issues: MigrationIssue[] = [];

  for (const table of [...input.base.tables, ...input.current.tables]) {
    if (table.incomplete_reason !== null) {
      issues.push({
        table: `${table.schema}.${table.name}`,
        column: null,
        detail: `Metadaten unvollständig: ${table.incomplete_reason}`,
      });
    }
  }

  const collected: Omit<MigrationStatement, "id">[] = [];
  for (const entry of input.entries) {
    collected.push(...statementsForEntry(entry, input, style, issues));
  }

  const ordered = collected
    .map((statement, index) => ({ statement, index }))
    .sort(
      (a, b) =>
        STATEMENT_ORDER[a.statement.kind] - STATEMENT_ORDER[b.statement.kind] ||
        a.statement.table.localeCompare(b.statement.table) ||
        a.index - b.index,
    )
    .map(({ statement }, position) => ({
      ...statement,
      id: `${position + 1}-${statement.kind}-${statement.table}${statement.column ? `.${statement.column}` : ""}`,
    }));

  const dangerousCount = ordered.filter((statement) => statement.dangerous).length;
  const statements = includeDangerous
    ? ordered
    : ordered.filter((statement) => !statement.dangerous);

  const partial: Omit<MigrationScript, "sql"> = {
    statements,
    issues,
    transactional: migrationTransactional(input.kind),
    dangerousCount: includeDangerous ? dangerousCount : 0,
    skippedDangerous: includeDangerous ? 0 : dangerousCount,
  };

  return { ...partial, sql: renderScript(partial, input, generatedAt) };
}

export function migrationFileName(schema: string, generatedAt: string): string {
  const stamp = generatedAt.replace(/[:.]/g, "-").replace(/Z$/, "");
  const safeSchema = schema.replace(/[^A-Za-z0-9_-]/g, "_") || "schema";
  return `migration-${safeSchema}-${stamp}.sql`;
}
