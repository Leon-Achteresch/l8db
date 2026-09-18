import type { ForeignKeyInfo } from "@/lib/db";

export function formatFkFilter(column: string, value: unknown): string {
  if (value === null || value === undefined) return "";
  const escaped = String(value).replace(/'/g, "''");
  if (typeof value === "number") return `"${column}" = ${value}`;
  return `"${column}" = '${escaped}'`;
}

export type FkLink = {
  schema: string;
  table: string;
  column: string;
  isOutgoing: boolean;
};

export function fkLinksFor(
  fks: ForeignKeyInfo[],
  currentSchema: string,
  currentTable: string,
  currentColumn: string,
): FkLink[] {
  const links: FkLink[] = [];
  const seen = new Set<string>();
  const add = (link: FkLink) => {
    const key = `${link.isOutgoing}|${link.schema}.${link.table}.${link.column}`;
    if (seen.has(key)) return;
    seen.add(key);
    links.push(link);
  };
  for (const fk of fks) {
    if (
      fk.from_schema === currentSchema &&
      fk.from_table === currentTable &&
      fk.from_column === currentColumn
    ) {
      add({ schema: fk.to_schema, table: fk.to_table, column: fk.to_column, isOutgoing: true });
    }
    if (
      fk.to_schema === currentSchema &&
      fk.to_table === currentTable &&
      fk.to_column === currentColumn
    ) {
      add({
        schema: fk.from_schema,
        table: fk.from_table,
        column: fk.from_column,
        isOutgoing: false,
      });
    }
  }
  return links.sort((a, b) => Number(b.isOutgoing) - Number(a.isOutgoing));
}
