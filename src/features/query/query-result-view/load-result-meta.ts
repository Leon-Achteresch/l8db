import type { SavedConnection } from "@/lib/connections";
import {
  type DetailedColumnInfo,
  describeQueryColumns,
  listForeignKeys,
  listTableColumnsDetailed,
  type TableInfo,
} from "@/lib/db";
import {
  type ColumnOrigin,
  originsByName,
  originTables,
  type SourceTableMeta,
  singleSourceTable,
} from "@/lib/query-result-view";
import { expandSessionViews, sessionViewsFor } from "@/lib/session-views";
import { effectiveConnectionString } from "@/lib/ssh";

export interface ResultMeta {
  origins: (ColumnOrigin | null)[];
  types: (string | null)[];
  sources: SourceTableMeta[];
}

interface LoadResultMetaOptions {
  connection: SavedConnection;
  database: string | null;
  text: string;
  columns: string[];
  tables: TableInfo[];
  foreignKeys: boolean;
}

function resolveTable(
  schema: string | null,
  table: string,
  tables: TableInfo[],
): { schema: string; table: string } | null {
  const name = table.toLowerCase();
  const owner = schema?.toLowerCase();
  const match =
    tables.find((entry) => entry.name === table && (!schema || entry.schema === schema)) ??
    tables.find(
      (entry) =>
        entry.name.toLowerCase() === name && (!owner || entry.schema.toLowerCase() === owner),
    );
  if (match) return { schema: match.schema, table: match.name };
  return schema ? { schema, table } : null;
}

export async function loadResultMeta({
  connection,
  database,
  text,
  columns,
  tables,
  foreignKeys,
}: LoadResultMetaOptions): Promise<ResultMeta> {
  const kind = connection.kind;
  const connectionString = effectiveConnectionString(connection);
  const db = database ?? undefined;
  const detailCache = new Map<string, Promise<DetailedColumnInfo[]>>();
  const detailsFor = (schema: string, table: string) => {
    const key = JSON.stringify([schema, table]);
    let pending = detailCache.get(key);
    if (!pending) {
      pending = listTableColumnsDetailed(kind, connectionString, schema, table, db).catch(() => []);
      detailCache.set(key, pending);
    }
    return pending;
  };
  let origins: (ColumnOrigin | null)[] = columns.map(() => null);
  let types: (string | null)[] = columns.map(() => null);
  let described = false;
  if (kind === "postgres") {
    const expanded = expandSessionViews(text, sessionViewsFor(connection.id, database), kind);
    const sources = await describeQueryColumns(kind, connectionString, expanded, db).catch(
      () => null,
    );
    if (sources && sources.length === columns.length) {
      described = true;
      types = sources.map((source) => source.data_type || null);
      origins = sources.map((source) =>
        source.schema && source.table && source.column
          ? { schema: source.schema, table: source.table, column: source.column }
          : null,
      );
    }
  }
  if (!described) {
    const single = singleSourceTable(text, kind);
    const resolved = single ? resolveTable(single.schema, single.table, tables) : null;
    if (resolved) {
      const details = await detailsFor(resolved.schema, resolved.table);
      if (details.length > 0)
        origins = originsByName(
          columns,
          resolved.schema,
          resolved.table,
          details.map((detail) => detail.name),
        );
    }
  }
  const sources = await Promise.all(
    originTables(origins).map(async ({ schema, table }) => ({
      schema,
      table,
      columns: await detailsFor(schema, table),
      foreignKeys: foreignKeys
        ? await listForeignKeys(kind, connectionString, schema, table, db).catch(() => [])
        : [],
    })),
  );
  return { origins, types, sources };
}
