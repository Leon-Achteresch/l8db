import type { ConstraintInfo, DetailedColumnInfo, IndexInfo } from "@/lib/db";
import { checksum } from "./model";
import { requalify } from "./schema";

type Row = Record<string, unknown>;
const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;

export function oracleConstraintMetadataSql(schema: string, table: string) {
  return `SELECT c.constraint_name AS "name", c.generated AS "generated", c.status AS "status", c.validated AS "validated", c.deferrable AS "deferrable", c.deferred AS "deferred", c.delete_rule AS "delete_rule", p.owner AS "referenced_schema", p.table_name AS "referenced_table", (SELECT LISTAGG(cc.column_name, ',') WITHIN GROUP (ORDER BY cc.position) FROM all_cons_columns cc WHERE cc.owner = p.owner AND cc.constraint_name = p.constraint_name) AS "referenced_columns" FROM all_constraints c LEFT JOIN all_constraints p ON p.owner = c.r_owner AND p.constraint_name = c.r_constraint_name WHERE c.owner = ${literal(schema)} AND c.table_name = ${literal(table)}`;
}

export function oracleIdentityMetadataSql(schema: string, table?: string) {
  return `SELECT i.column_name AS "column", i.generation_type AS "generation", i.sequence_name AS "sequence", i.identity_options AS "options", c.default_on_null AS "onNull" FROM all_tab_identity_cols i JOIN all_tab_cols c ON c.owner = i.owner AND c.table_name = i.table_name AND c.column_name = i.column_name WHERE i.owner = ${literal(schema)}${table ? ` AND i.table_name = ${literal(table)}` : ""}`;
}

export function oracleIdentityDefault(row: Row): string {
  const generation = row.generation;
  if (
    !["ALWAYS", "BY DEFAULT"].includes(String(generation)) ||
    !["YES", "NO"].includes(String(row.onNull)) ||
    (generation === "ALWAYS" && row.onNull === "YES") ||
    typeof row.options !== "string" ||
    !row.options.trim()
  )
    throw new Error("Identity-Metadaten sind unvollständig.");
  const keys = new Set<string>();
  const options = row.options.split(",").map((option) => {
    const match = /^\s*([^:]+):\s*(.+?)\s*$/.exec(option);
    if (!match || match[2].includes(":")) throw new Error("Identity-Option ist nicht eindeutig.");
    const key = match[1].trim().replace(/\s+/g, " ");
    const value = match[2].trim().replace(/\s+/g, " ");
    if (!key || !value) throw new Error("Identity-Option ist nicht eindeutig.");
    if (keys.has(key)) throw new Error("Identity-Option ist doppelt.");
    keys.add(key);
    return `${key}: ${value}`;
  });
  return `IDENTITY ${generation}${row.onNull === "YES" ? " ON NULL" : ""} (${options.sort().join(", ")})`;
}

export function portableOracleIdentityColumns(columns: DetailedColumnInfo[], rows: Row[]) {
  const identities = new Map<string, string>();
  for (const row of rows) {
    if (
      typeof row.column !== "string" ||
      !columns.some((column) => column.name === row.column) ||
      identities.has(row.column)
    )
      throw new Error("Identity-Spalte ist nicht eindeutig.");
    identities.set(row.column, oracleIdentityDefault(row));
  }
  return columns.map((column) => ({
    ...column,
    column_default: identities.get(column.name) ?? column.column_default,
  }));
}

export function redundantOracleNotNull(
  constraint: ConstraintInfo,
  row: Row,
  columns: DetailedColumnInfo[],
) {
  if (
    row.generated !== "GENERATED NAME" ||
    row.status !== "ENABLED" ||
    row.validated !== "VALIDATED" ||
    row.deferrable !== "NOT DEFERRABLE" ||
    row.deferred !== "IMMEDIATE" ||
    constraint.constraint_type !== "CHECK" ||
    constraint.columns.length !== 1
  )
    return false;
  const column = columns.find((entry) => entry.name === constraint.columns[0]);
  return Boolean(
    column &&
      !column.is_nullable &&
      constraint.definition.replace(/\s+/g, " ").trim() ===
        `CHECK (${quote(column.name)} IS NOT NULL)`,
  );
}

export async function portableOracleMetadata(
  constraints: ConstraintInfo[],
  indexes: IndexInfo[],
  rows: Row[],
  schema: string,
  sourceSchema: string,
  columns?: DetailedColumnInfo[],
) {
  const names = new Map<string, string>();
  const normalized: ConstraintInfo[] = [];
  for (const constraint of constraints) {
    const row = rows.find((row) => row.name === constraint.name);
    if (!row) throw new Error(`Constraint-Metadaten für ${constraint.name} sind unvollständig.`);
    if (columns && redundantOracleNotNull(constraint, row, columns)) continue;
    let definition = constraint.definition;
    if (constraint.constraint_type === "FOREIGN KEY") {
      if (!row.referenced_schema || !row.referenced_table || !row.referenced_columns)
        throw new Error("Fremdschlüssel-Ziel ist nicht lesbar.");
      definition = `FOREIGN KEY (${constraint.columns.map(quote).join(", ")}) REFERENCES ${quote(String(row.referenced_schema))}.${quote(String(row.referenced_table))} (${String(row.referenced_columns).split(",").map(quote).join(", ")}) ON DELETE ${row.delete_rule}`;
    }
    definition += ` [${row.status}; ${row.validated}; ${row.deferrable}; ${row.deferred}]`;
    let name = constraint.name;
    if (row.generated === "GENERATED NAME") {
      name = `L8DB_GENERATED_${(await checksum(JSON.stringify([constraint.constraint_type, constraint.columns, requalify(definition, schema, sourceSchema)]))).slice(0, 16).toUpperCase()}`;
      names.set(constraint.name, name);
    }
    normalized.push({ ...constraint, name, definition });
  }
  return {
    constraints: normalized,
    indexes: indexes.map((index) => {
      const name = names.get(index.name);
      if (!name) return index;
      const definition = index.definition.replace(
        `INDEX ${quote(index.name)} ON`,
        `INDEX ${quote(name)} ON`,
      );
      return { ...index, name, definition };
    }),
  };
}
