import type { DatabaseKind, ForeignKeyInfo } from "@/lib/db";
import { masterColumnReference } from "@/lib/master-detail";
import { quoteIdent } from "@/lib/sql-filter";

export type MasterDetailRelation = {
  id: string;
  constraint: string;
  direction: "parent" | "child";
  schema: string;
  table: string;
  columns: { source: string; target: string }[];
};

export function masterDetailRelations(
  keys: ForeignKeyInfo[],
  schema: string,
  table: string,
): MasterDetailRelation[] {
  const groups = new Map<string, MasterDetailRelation>();
  for (const fk of keys) {
    for (const direction of ["parent", "child"] as const) {
      const parent = direction === "parent";
      if (
        (parent ? fk.from_schema : fk.to_schema) !== schema ||
        (parent ? fk.from_table : fk.to_table) !== table
      )
        continue;
      const id = JSON.stringify([
        direction,
        fk.from_schema,
        fk.from_table,
        fk.constraint_name,
        fk.to_schema,
        fk.to_table,
      ]);
      const relation = groups.get(id) ?? {
        id,
        constraint: fk.constraint_name,
        direction,
        schema: parent ? fk.to_schema : fk.from_schema,
        table: parent ? fk.to_table : fk.from_table,
        columns: [],
      };
      const column = {
        source: parent ? fk.from_column : fk.to_column,
        target: parent ? fk.to_column : fk.from_column,
      };
      if (
        !relation.columns.some(
          (entry) => entry.source === column.source && entry.target === column.target,
        )
      )
        relation.columns.push(column);
      groups.set(id, relation);
    }
  }
  return [...groups.values()];
}

export function masterDetailRelationSql(
  relation: MasterDetailRelation,
  kind: DatabaseKind,
): string {
  const table = `${quoteIdent(relation.schema, kind)}.${quoteIdent(relation.table, kind)}`;
  const where = relation.columns
    .map((column) => `${quoteIdent(column.target, kind)} = ${masterColumnReference(column.source)}`)
    .join("\n  AND ");
  return `SELECT ${kind === "mssql" ? "TOP (100) " : ""}*\nFROM ${table}\nWHERE ${where}${kind === "mssql" ? "" : kind === "oracle" ? "\nFETCH FIRST 100 ROWS ONLY" : "\nLIMIT 100"}`;
}
