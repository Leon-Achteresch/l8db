import type { DatabaseKind, TableConstraintSpec } from "@/lib/db";

export type ConstraintKind = TableConstraintSpec["kind"];

export interface ConstraintDialectInfo {
  deleteActions: string[];
  updateActions: string[];
  deferrable: boolean;
  alter: boolean;
  createNote: string | null;
  alterNote: string | null;
}

const ALL_ACTIONS = ["NO ACTION", "RESTRICT", "CASCADE", "SET NULL", "SET DEFAULT"];

const REBUILD_NOTE =
  "kann Constraints bestehender Tabellen nicht per ALTER TABLE ändern. Constraints beim Anlegen definieren oder die Tabelle neu aufbauen (neue Tabelle anlegen, Daten kopieren, alte ersetzen).";

export function constraintDialectInfo(
  kind: DatabaseKind | undefined,
): ConstraintDialectInfo | null {
  switch (kind) {
    case "postgres":
      return {
        deleteActions: ALL_ACTIONS,
        updateActions: ALL_ACTIONS,
        deferrable: true,
        alter: true,
        createNote: null,
        alterNote: null,
      };
    case "mysql":
      return {
        deleteActions: ["NO ACTION", "RESTRICT", "CASCADE", "SET NULL"],
        updateActions: ["NO ACTION", "RESTRICT", "CASCADE", "SET NULL"],
        deferrable: false,
        alter: true,
        createNote: "CHECK-Constraints werden ab MySQL 8.0.16 bzw. MariaDB 10.2 geprüft.",
        alterNote: null,
      };
    case "sqlite":
      return {
        deleteActions: ALL_ACTIONS,
        updateActions: ALL_ACTIONS,
        deferrable: true,
        alter: false,
        createNote:
          "SQLite prüft Fremdschlüssel nur, wenn PRAGMA foreign_keys = ON für die Verbindung gesetzt ist.",
        alterNote: `SQLite ${REBUILD_NOTE}`,
      };
    case "mssql":
      return {
        deleteActions: ["NO ACTION", "CASCADE", "SET NULL", "SET DEFAULT"],
        updateActions: ["NO ACTION", "CASCADE", "SET NULL", "SET DEFAULT"],
        deferrable: false,
        alter: true,
        createNote: null,
        alterNote: null,
      };
    case "oracle":
      return {
        deleteActions: ["NO ACTION", "CASCADE", "SET NULL"],
        updateActions: ["NO ACTION"],
        deferrable: true,
        alter: true,
        createNote: "Oracle kennt kein ON UPDATE für Fremdschlüssel.",
        alterNote: null,
      };
    case "duckdb":
      return {
        deleteActions: ["NO ACTION"],
        updateActions: ["NO ACTION"],
        deferrable: false,
        alter: false,
        createNote: "DuckDB unterstützt keine referenziellen Aktionen (CASCADE, SET NULL …).",
        alterNote: `DuckDB ${REBUILD_NOTE}`,
      };
    default:
      return null;
  }
}

const TYPE_FAMILIES: [RegExp, string][] = [
  [
    /^(tinyint|smallint|mediumint|int|integer|bigint|int2|int4|int8|serial|smallserial|bigserial|serial2|serial4|serial8|u?int(8|16|32|64|128|256)|hugeint|ubigint|uinteger|usmallint|utinyint|numeric|decimal|number|real|float|float4|float8|double|double precision|money|smallmoney|binary_float|binary_double)$/,
    "number",
  ],
  [
    /^(char|character|varchar|character varying|nchar|nvarchar|varchar2|nvarchar2|text|tinytext|mediumtext|longtext|ntext|string|citext|clob|nclob|bpchar|name)$/,
    "text",
  ],
  [/^(uuid|uniqueidentifier)$/, "uuid"],
  [/^(bool|boolean|bit)$/, "boolean"],
  [/^date$/, "date"],
  [
    /^(timestamp|timestamptz|timestamp with time zone|timestamp without time zone|datetime|datetime2|smalldatetime|datetimeoffset)$/,
    "timestamp",
  ],
  [/^(bytea|blob|binary|varbinary|raw|longblob|mediumblob|tinyblob|image)$/, "binary"],
];

export function typeFamily(dataType: string | undefined | null): string | null {
  if (!dataType) return null;
  const base = dataType
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/\b(unsigned|zerofill|signed)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (base.endsWith("[]")) return null;
  for (const [pattern, family] of TYPE_FAMILIES) if (pattern.test(base)) return family;
  return null;
}

export interface ColumnRef {
  name: string;
  data_type: string;
  is_primary_key?: boolean;
}

export function foreignKeyIssues(
  spec: Extract<TableConstraintSpec, { kind: "foreign_key" }>,
  localColumns: ColumnRef[],
  referencedColumns: ColumnRef[] | null,
): string[] {
  const issues: string[] = [];
  if (spec.columns.length === 0) issues.push("Mindestens eine lokale Spalte wählen.");
  if (!spec.ref_table.trim()) issues.push("Referenzierte Tabelle wählen.");
  if (spec.ref_columns.length === 0) issues.push("Mindestens eine referenzierte Spalte wählen.");
  if (
    spec.columns.length > 0 &&
    spec.ref_columns.length > 0 &&
    spec.columns.length !== spec.ref_columns.length
  )
    issues.push(
      `Spaltenanzahl passt nicht: ${spec.columns.length} lokal, ${spec.ref_columns.length} referenziert.`,
    );
  if (spec.initially_deferred && !spec.deferrable)
    issues.push("INITIALLY DEFERRED setzt DEFERRABLE voraus.");
  if (!referencedColumns) return issues;
  const pairs = Math.min(spec.columns.length, spec.ref_columns.length);
  for (let index = 0; index < pairs; index += 1) {
    const local = localColumns.find((c) => c.name === spec.columns[index]);
    const target = referencedColumns.find((c) => c.name === spec.ref_columns[index]);
    if (!target) {
      issues.push(`Spalte "${spec.ref_columns[index]}" existiert in der Zieltabelle nicht.`);
      continue;
    }
    const localFamily = typeFamily(local?.data_type);
    const targetFamily = typeFamily(target.data_type);
    if (localFamily && targetFamily && localFamily !== targetFamily)
      issues.push(
        `Typen passen nicht: ${spec.columns[index]} (${local?.data_type}) → ${target.name} (${target.data_type}).`,
      );
  }
  return issues;
}

export function constraintIssues(
  spec: TableConstraintSpec,
  localColumns: ColumnRef[],
  referencedColumns: ColumnRef[] | null,
): string[] {
  switch (spec.kind) {
    case "check":
      return spec.expression.trim() ? [] : ["Ausdruck für CHECK angeben."];
    case "foreign_key":
      return foreignKeyIssues(spec, localColumns, referencedColumns);
    default:
      return spec.columns.length === 0 ? ["Mindestens eine Spalte wählen."] : [];
  }
}

export function emptyConstraint(kind: ConstraintKind): TableConstraintSpec {
  switch (kind) {
    case "check":
      return { kind, name: null, expression: "" };
    case "foreign_key":
      return {
        kind,
        name: null,
        columns: [],
        ref_schema: null,
        ref_table: "",
        ref_columns: [],
        on_delete: null,
        on_update: null,
        deferrable: false,
        initially_deferred: false,
      };
    default:
      return { kind, name: null, columns: [] };
  }
}

export function suggestedConstraintName(table: string, spec: TableConstraintSpec): string {
  const base = table.trim() || "tabelle";
  switch (spec.kind) {
    case "primary_key":
      return `pk_${base}`;
    case "unique":
      return `uq_${base}_${spec.columns.join("_") || "spalten"}`;
    case "check":
      return `ck_${base}`;
    case "foreign_key":
      return `fk_${base}_${spec.ref_table || "ziel"}`;
  }
}

export const CONSTRAINT_KIND_LABEL: Record<ConstraintKind, string> = {
  primary_key: "Primärschlüssel",
  unique: "Unique",
  check: "Check",
  foreign_key: "Fremdschlüssel",
};

export function describeConstraint(spec: TableConstraintSpec): string {
  switch (spec.kind) {
    case "primary_key":
      return `PRIMARY KEY (${spec.columns.join(", ")})`;
    case "unique":
      return `UNIQUE (${spec.columns.join(", ")})`;
    case "check":
      return `CHECK (${spec.expression.trim()})`;
    case "foreign_key": {
      const target = spec.ref_schema ? `${spec.ref_schema}.${spec.ref_table}` : spec.ref_table;
      const actions = [
        spec.on_delete && spec.on_delete !== "NO ACTION" ? `ON DELETE ${spec.on_delete}` : "",
        spec.on_update && spec.on_update !== "NO ACTION" ? `ON UPDATE ${spec.on_update}` : "",
        spec.deferrable ? (spec.initially_deferred ? "DEFERRABLE DEFERRED" : "DEFERRABLE") : "",
      ].filter(Boolean);
      return [
        `FOREIGN KEY (${spec.columns.join(", ")}) → ${target} (${spec.ref_columns.join(", ")})`,
        ...actions,
      ].join(" ");
    }
  }
}

export function renameConstraintColumn(
  spec: TableConstraintSpec,
  from: string,
  to: string,
): TableConstraintSpec {
  if (spec.kind === "check") return spec;
  return { ...spec, columns: spec.columns.map((column) => (column === from ? to : column)) };
}

export function constraintUsesColumns(spec: TableConstraintSpec, columns: string[]): boolean {
  if (spec.kind === "check") return true;
  return spec.columns.every((column) => columns.includes(column));
}
