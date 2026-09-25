import type {
  ColumnValueOptions,
  ConstraintInfo,
  DatabaseKind,
  DetailedColumnInfo,
  TableConstraintSpec,
} from "@/lib/db";

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

type Token =
  | { type: "string"; value: string }
  | { type: "number"; value: string }
  | { type: "ident"; value: string }
  | { type: "word"; value: string }
  | { type: "punct"; value: string };

const KEYWORDS = new Set(["IN", "OR", "AND", "ANY", "ARRAY", "NOT", "CHECK"]);

function tokenize(source: string): Token[] | null {
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (char === "'") {
      let end = index + 1;
      let value = "";
      while (end < source.length) {
        if (source[end] === "'" && source[end + 1] === "'") {
          value += "'";
          end += 2;
          continue;
        }
        if (source[end] === "'") break;
        value += source[end];
        end += 1;
      }
      if (end >= source.length) return null;
      tokens.push({ type: "string", value });
      index = end + 1;
      continue;
    }
    if (char === '"' || char === "`") {
      const end = source.indexOf(char, index + 1);
      if (end < 0) return null;
      tokens.push({ type: "ident", value: source.slice(index + 1, end) });
      index = end + 1;
      continue;
    }
    const previous = tokens[tokens.length - 1];
    if (char === "[" && !(previous?.type === "word" && previous.value === "ARRAY")) {
      const end = source.indexOf("]", index + 1);
      if (end > index + 1) {
        tokens.push({ type: "ident", value: source.slice(index + 1, end) });
        index = end + 1;
        continue;
      }
    }
    const number = /^-?\d+(?:\.\d+)?/.exec(source.slice(index));
    if (number && !(previous && (previous.type === "ident" || previous.type === "number"))) {
      tokens.push({ type: "number", value: number[0] });
      index += number[0].length;
      continue;
    }
    if (source.startsWith("::", index)) {
      tokens.push({ type: "punct", value: "::" });
      index += 2;
      continue;
    }
    const word = /^[A-Za-z_][\w$]*/.exec(source.slice(index));
    if (word) {
      const upper = word[0].toUpperCase();
      tokens.push(
        KEYWORDS.has(upper) ? { type: "word", value: upper } : { type: "ident", value: word[0] },
      );
      index += word[0].length;
      continue;
    }
    tokens.push({ type: "punct", value: char });
    index += 1;
  }
  return tokens;
}

function stripCastsAndParens(tokens: Token[]): Token[] {
  const out: Token[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type === "punct" && token.value === "::") {
      while (tokens[index + 1]?.type === "ident") index += 1;
      if (tokens[index + 1]?.value === "[" && tokens[index + 2]?.value === "]") index += 2;
      continue;
    }
    if (token.type === "punct" && (token.value === "(" || token.value === ")")) continue;
    out.push(token);
  }
  return out;
}

function literalList(tokens: Token[], start: number, end: number): string[] | null {
  const values: string[] = [];
  for (let index = start; index < end; index += 1) {
    const token = tokens[index];
    const expectValue = (index - start) % 2 === 0;
    if (expectValue) {
      if (token.type !== "string" && token.type !== "number") return null;
      values.push(token.value);
    } else if (token.value !== ",") return null;
  }
  return values.length > 0 && (end - start) % 2 === 1 ? values : null;
}

export function parseCheckValues(definition: string): { column: string; values: string[] } | null {
  const normalized = definition
    .trim()
    .replace(/\\'/g, "'")
    .replace(/(^|[\s,(=])_[a-z][a-z0-9]*'/gi, "$1'")
    .replace(/(^|[\s,(=])N'/g, "$1'");
  const raw = tokenize(normalized);
  if (!raw) return null;
  const tokens = stripCastsAndParens(raw).filter(
    (token, index) => !(index === 0 && token.type === "word" && token.value === "CHECK"),
  );
  const [first, second] = tokens;
  if (first?.type !== "ident") return null;
  if (second?.type === "word" && second.value === "IN") {
    const values = literalList(tokens, 2, tokens.length);
    return values ? { column: first.value, values } : null;
  }
  if (
    second?.value === "=" &&
    tokens[2]?.value === "ANY" &&
    tokens[3]?.value === "ARRAY" &&
    tokens[4]?.value === "[" &&
    tokens[tokens.length - 1]?.value === "]"
  ) {
    const values = literalList(tokens, 5, tokens.length - 1);
    return values ? { column: first.value, values } : null;
  }
  if (second?.value === "=") {
    const values: string[] = [];
    for (let index = 0; index < tokens.length; index += 4) {
      const [ident, eq, literal, separator] = tokens.slice(index, index + 4);
      if (ident?.type !== "ident" || ident.value !== first.value || eq?.value !== "=") return null;
      if (literal?.type !== "string" && literal?.type !== "number") return null;
      values.push(literal.value);
      if (separator && separator.value !== "OR") return null;
    }
    return values.length > 1 ? { column: first.value, values } : null;
  }
  return null;
}

export function parseEnumTypeValues(dataType: string): string[] | null {
  const match = /^\s*enum\s*\((.*)\)\s*$/i.exec(dataType);
  if (!match) return null;
  const tokens = tokenize(match[1]);
  if (!tokens) return null;
  return literalList(tokens, 0, tokens.length);
}

export function buildColumnValueOptions(
  columns: DetailedColumnInfo[] | undefined,
  constraints: ConstraintInfo[] | undefined,
  enumColumns: ColumnValueOptions[] | undefined,
): Record<string, string[]> {
  const options: Record<string, string[]> = {};
  const names = (columns ?? []).map((column) => column.name);
  const resolve = (name: string) =>
    names.find((column) => column === name) ??
    names.find((column) => column.toLowerCase() === name.toLowerCase());
  for (const constraint of constraints ?? []) {
    if (constraint.constraint_type.toUpperCase() !== "CHECK") continue;
    const parsed = parseCheckValues(constraint.definition);
    if (!parsed) continue;
    const column = resolve(parsed.column);
    if (column) options[column] = parsed.values;
  }
  for (const column of columns ?? []) {
    const values = parseEnumTypeValues(column.data_type);
    if (values) options[column.name] = values;
  }
  for (const entry of enumColumns ?? []) {
    if (entry.values.length > 0) options[entry.column] = entry.values;
  }
  return options;
}
