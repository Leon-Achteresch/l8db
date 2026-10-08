import type { DetailedColumnInfo, ForeignKeyInfo } from "@/lib/db";

export const QUERY_RESULT_SCHEMA = "__l8db_query__";

export interface ColumnOrigin {
  schema: string;
  table: string;
  column: string;
}

export interface SourceTableMeta {
  schema: string;
  table: string;
  columns: DetailedColumnInfo[];
  foreignKeys: ForeignKeyInfo[];
}

export function originTables(
  origins: (ColumnOrigin | null)[],
): { schema: string; table: string }[] {
  const seen = new Map<string, { schema: string; table: string }>();
  for (const origin of origins) {
    if (!origin) continue;
    const key = JSON.stringify([origin.schema, origin.table]);
    if (!seen.has(key)) seen.set(key, { schema: origin.schema, table: origin.table });
  }
  return [...seen.values()];
}

export function originsByName(
  columns: string[],
  schema: string,
  table: string,
  tableColumns: string[],
): (ColumnOrigin | null)[] {
  const exact = new Set(tableColumns);
  const folded = new Map(tableColumns.map((name) => [name.toLowerCase(), name]));
  return columns.map((name) => {
    const column = exact.has(name) ? name : folded.get(name.toLowerCase());
    return column ? { schema, table, column } : null;
  });
}

function sameOrigin(origin: ColumnOrigin, schema: string, table: string, column: string) {
  return origin.schema === schema && origin.table === table && origin.column === column;
}

export function resultForeignKeys(
  columns: string[],
  origins: (ColumnOrigin | null)[],
  sources: SourceTableMeta[],
  resultTable: string,
): ForeignKeyInfo[] {
  const keys = new Set<string>();
  const result: ForeignKeyInfo[] = [];
  const push = (fk: ForeignKeyInfo) => {
    const key = JSON.stringify(fk);
    if (keys.has(key)) return;
    keys.add(key);
    result.push(fk);
  };
  const foreignKeys = sources.flatMap((source) => source.foreignKeys);
  columns.forEach((name, index) => {
    const origin = origins[index];
    if (!origin) return;
    for (const fk of foreignKeys) {
      if (sameOrigin(origin, fk.from_schema, fk.from_table, fk.from_column))
        push({
          ...fk,
          from_schema: QUERY_RESULT_SCHEMA,
          from_table: resultTable,
          from_column: name,
        });
      if (sameOrigin(origin, fk.to_schema, fk.to_table, fk.to_column))
        push({ ...fk, to_schema: QUERY_RESULT_SCHEMA, to_table: resultTable, to_column: name });
    }
  });
  return result;
}

export function resultColumnDetails(
  columns: string[],
  origins: (ColumnOrigin | null)[],
  types: (string | null)[],
  sources: SourceTableMeta[],
): DetailedColumnInfo[] {
  return columns.map((name, index) => {
    const origin = origins[index];
    const source = origin
      ? sources.find((entry) => entry.schema === origin.schema && entry.table === origin.table)
      : undefined;
    const detail = origin
      ? source?.columns.find((column) => column.name === origin.column)
      : undefined;
    return {
      name,
      data_type: detail?.data_type ?? types[index] ?? "",
      is_nullable: detail?.is_nullable ?? true,
      column_default: null,
      is_primary_key: detail?.is_primary_key ?? false,
      ordinal_position: index + 1,
      character_maximum_length: detail?.character_maximum_length ?? null,
      comment: detail?.comment ?? null,
    };
  });
}
