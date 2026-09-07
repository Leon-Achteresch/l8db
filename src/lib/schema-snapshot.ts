import type { DetailedColumnInfo } from "@/lib/db";

export const SCHEMA_SNAPSHOT_VERSION = 1;

export interface SnapshotColumn {
  name: string;
  data_type: string;
  is_nullable: boolean;
  column_default: string | null;
  is_primary_key: boolean;
  ordinal_position: number;
  character_maximum_length: number | null;
}

export interface SnapshotTable {
  schema: string;
  name: string;
  columns: SnapshotColumn[];
  primary_key: string[];
  incomplete_reason: string | null;
}

export interface SnapshotScope {
  connection_name: string;
  kind: string;
  database: string | null;
  schema: string;
  requested_tables: string[];
}

export interface SchemaSnapshot {
  version: number;
  captured_at: string;
  scope: SnapshotScope;
  complete: boolean;
  tables: SnapshotTable[];
}

export type SnapshotDiffKind =
  | "table_added"
  | "table_removed"
  | "column_added"
  | "column_removed"
  | "column_changed"
  | "primary_key_changed";

export interface SnapshotDiffEntry {
  kind: SnapshotDiffKind;
  table: string;
  column: string | null;
  before: string | null;
  after: string | null;
  detail: string;
}

export function toSnapshotColumn(column: DetailedColumnInfo): SnapshotColumn {
  return {
    name: column.name,
    data_type: column.data_type,
    is_nullable: column.is_nullable,
    column_default: column.column_default,
    is_primary_key: column.is_primary_key,
    ordinal_position: column.ordinal_position,
    character_maximum_length: column.character_maximum_length,
  };
}

export function primaryKeyColumns(columns: SnapshotColumn[]): string[] {
  return columns.filter((column) => column.is_primary_key).map((column) => column.name);
}

export function buildSnapshotTable(
  schema: string,
  name: string,
  columns: DetailedColumnInfo[],
  incompleteReason: string | null = null,
): SnapshotTable {
  const mapped = columns
    .map(toSnapshotColumn)
    .sort((a, b) => a.ordinal_position - b.ordinal_position || a.name.localeCompare(b.name));
  return {
    schema,
    name,
    columns: mapped,
    primary_key: primaryKeyColumns(mapped),
    incomplete_reason: incompleteReason,
  };
}

export function buildSnapshot(
  scope: SnapshotScope,
  tables: SnapshotTable[],
  capturedAt: Date = new Date(),
): SchemaSnapshot {
  const sorted = [...tables].sort(
    (a, b) => a.schema.localeCompare(b.schema) || a.name.localeCompare(b.name),
  );
  return {
    version: SCHEMA_SNAPSHOT_VERSION,
    captured_at: capturedAt.toISOString(),
    scope: {
      connection_name: scope.connection_name,
      kind: scope.kind,
      database: scope.database,
      schema: scope.schema,
      requested_tables: [...scope.requested_tables].sort((a, b) => a.localeCompare(b)),
    },
    complete: sorted.every((table) => table.incomplete_reason === null),
    tables: sorted,
  };
}

export function serializeSnapshot(snapshot: SchemaSnapshot): string {
  return `${JSON.stringify(snapshot, null, 2)}\n`;
}

export function snapshotFileName(schema: string, capturedAt: string): string {
  const stamp = capturedAt.replace(/[:.]/g, "-").replace(/Z$/, "");
  const safeSchema = schema.replace(/[^A-Za-z0-9_-]/g, "_") || "schema";
  return `snapshot-${safeSchema}-${stamp}.json`;
}

function isValidSnapshotTable(value: unknown): value is SnapshotTable {
  if (!value || typeof value !== "object") return false;
  const table = value as Partial<SnapshotTable>;
  return (
    typeof table.schema === "string" &&
    typeof table.name === "string" &&
    Array.isArray(table.columns) &&
    Array.isArray(table.primary_key)
  );
}

export function parseSnapshot(text: string): SchemaSnapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("Snapshot-Datei ist kein gültiges JSON.");
  }
  if (!raw || typeof raw !== "object") {
    throw new Error("Snapshot-Datei hat kein Objekt auf oberster Ebene.");
  }
  const candidate = raw as Partial<SchemaSnapshot>;
  if (candidate.version !== SCHEMA_SNAPSHOT_VERSION) {
    throw new Error(
      `Snapshot-Version ${String(candidate.version)} wird nicht unterstützt (erwartet ${SCHEMA_SNAPSHOT_VERSION}).`,
    );
  }
  if (typeof candidate.captured_at !== "string" || !candidate.scope || !candidate.scope.schema) {
    throw new Error("Snapshot-Datei ist unvollständig (Zeitstempel oder Umfang fehlt).");
  }
  if (!Array.isArray(candidate.tables)) {
    throw new Error("Snapshot-Datei enthält keine Tabellenliste.");
  }
  for (const table of candidate.tables) {
    if (!isValidSnapshotTable(table)) {
      throw new Error("Snapshot-Datei enthält eine ungültige Tabelle.");
    }
  }
  return candidate as SchemaSnapshot;
}

function qualified(table: SnapshotTable): string {
  return `${table.schema}.${table.name}`;
}

function describeColumn(column: SnapshotColumn): string {
  const length =
    column.character_maximum_length === null ? "" : `(${column.character_maximum_length})`;
  const nullable = column.is_nullable ? "NULL" : "NOT NULL";
  const fallback = column.column_default === null ? "" : ` DEFAULT ${column.column_default}`;
  return `${column.data_type}${length} ${nullable}${fallback}`;
}

function columnChanges(before: SnapshotColumn, after: SnapshotColumn): string[] {
  const changes: string[] = [];
  if (before.data_type !== after.data_type) changes.push("Datentyp");
  if (before.character_maximum_length !== after.character_maximum_length) changes.push("Länge");
  if (before.is_nullable !== after.is_nullable) changes.push("Nullbarkeit");
  if (before.column_default !== after.column_default) changes.push("Vorgabewert");
  return changes;
}

export function diffSnapshots(base: SchemaSnapshot, current: SchemaSnapshot): SnapshotDiffEntry[] {
  const entries: SnapshotDiffEntry[] = [];
  const baseTables = new Map(base.tables.map((table) => [qualified(table), table]));
  const currentTables = new Map(current.tables.map((table) => [qualified(table), table]));

  for (const [name, table] of baseTables) {
    if (!currentTables.has(name)) {
      entries.push({
        kind: "table_removed",
        table: name,
        column: null,
        before: `${table.columns.length} Spalten`,
        after: null,
        detail: "Tabelle fehlt im aktuellen Stand",
      });
    }
  }

  for (const [name, table] of currentTables) {
    if (!baseTables.has(name)) {
      entries.push({
        kind: "table_added",
        table: name,
        column: null,
        before: null,
        after: `${table.columns.length} Spalten`,
        detail: "Tabelle ist neu",
      });
    }
  }

  for (const [name, baseTable] of baseTables) {
    const currentTable = currentTables.get(name);
    if (!currentTable) continue;
    const baseColumns = new Map(baseTable.columns.map((column) => [column.name, column]));
    const currentColumns = new Map(currentTable.columns.map((column) => [column.name, column]));

    for (const [columnName, column] of baseColumns) {
      if (!currentColumns.has(columnName)) {
        entries.push({
          kind: "column_removed",
          table: name,
          column: columnName,
          before: describeColumn(column),
          after: null,
          detail: "Spalte entfernt",
        });
      }
    }

    for (const [columnName, column] of currentColumns) {
      if (!baseColumns.has(columnName)) {
        entries.push({
          kind: "column_added",
          table: name,
          column: columnName,
          before: null,
          after: describeColumn(column),
          detail: "Spalte hinzugefügt",
        });
        continue;
      }
      const baseColumn = baseColumns.get(columnName) as SnapshotColumn;
      const changes = columnChanges(baseColumn, column);
      if (changes.length > 0) {
        entries.push({
          kind: "column_changed",
          table: name,
          column: columnName,
          before: describeColumn(baseColumn),
          after: describeColumn(column),
          detail: `Geändert: ${changes.join(", ")}`,
        });
      }
    }

    const basePk = baseTable.primary_key.join(", ");
    const currentPk = currentTable.primary_key.join(", ");
    if (basePk !== currentPk) {
      entries.push({
        kind: "primary_key_changed",
        table: name,
        column: null,
        before: basePk || "kein Primärschlüssel",
        after: currentPk || "kein Primärschlüssel",
        detail: "Primärschlüssel geändert",
      });
    }
  }

  return entries.sort(
    (a, b) => a.table.localeCompare(b.table) || (a.column ?? "").localeCompare(b.column ?? ""),
  );
}
