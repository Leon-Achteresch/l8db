import type { ConstraintInfo, IndexInfo } from "@/lib/db";
import { checksum } from "./model";
import { requalify } from "./schema";

type Row = Record<string, unknown>;
const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;

export function oracleConstraintMetadataSql(schema: string, table: string) {
  return `SELECT c.constraint_name AS "name", c.generated AS "generated", c.status AS "status", c.validated AS "validated", c.deferrable AS "deferrable", c.deferred AS "deferred", c.delete_rule AS "delete_rule", p.owner AS "referenced_schema", p.table_name AS "referenced_table", (SELECT LISTAGG(cc.column_name, ',') WITHIN GROUP (ORDER BY cc.position) FROM all_cons_columns cc WHERE cc.owner = p.owner AND cc.constraint_name = p.constraint_name) AS "referenced_columns" FROM all_constraints c LEFT JOIN all_constraints p ON p.owner = c.r_owner AND p.constraint_name = c.r_constraint_name WHERE c.owner = ${literal(schema)} AND c.table_name = ${literal(table)}`;
}

export async function portableOracleMetadata(
  constraints: ConstraintInfo[],
  indexes: IndexInfo[],
  rows: Row[],
  schema: string,
  sourceSchema: string,
) {
  const names = new Map<string, string>();
  const normalized: ConstraintInfo[] = [];
  for (const constraint of constraints) {
    const row = rows.find((row) => row.name === constraint.name);
    if (!row) throw new Error(`Constraint-Metadaten für ${constraint.name} sind unvollständig.`);
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
