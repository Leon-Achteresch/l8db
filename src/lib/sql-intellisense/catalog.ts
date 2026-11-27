import type { ColumnInfo, TableInfo } from "@/lib/db";

export const columnIndexes = new WeakMap<ColumnInfo[], Map<string, ColumnInfo[]>>();
const relationIndexes = new WeakMap<TableInfo[], Map<string, TableInfo[]>>();

function groupByName<T>(
  entries: T[],
  indexes: WeakMap<T[], Map<string, T[]>>,
  nameOf: (entry: T) => string,
) {
  const cached = indexes.get(entries);
  if (cached) return cached;
  const groups = new Map<string, T[]>();
  for (const entry of entries) {
    const name = nameOf(entry).toLowerCase();
    const group = groups.get(name);
    if (group) group.push(entry);
    else groups.set(name, [entry]);
  }
  indexes.set(entries, groups);
  return groups;
}

export function columnsByTable(columns: ColumnInfo[]) {
  return groupByName(columns, columnIndexes, (column) => column.table);
}

export function findRelation(tables: TableInfo[], name: string, schema: string | null | undefined) {
  const matches = groupByName(tables, relationIndexes, (table) => table.name).get(
    name.toLowerCase(),
  );
  const owner = schema?.toLowerCase();
  return owner ? matches?.find((table) => table.schema.toLowerCase() === owner) : matches?.[0];
}
