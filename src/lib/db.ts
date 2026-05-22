import { invoke } from "@tauri-apps/api/core";

export type DatabaseKind = "postgres";

export interface ConnectionConfig {
  kind: DatabaseKind;
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export async function testConnection(config: ConnectionConfig): Promise<void> {
  await invoke("test_connection", { config });
}

export async function testConnectionString(
  kind: DatabaseKind,
  connectionString: string,
): Promise<void> {
  await invoke("test_connection_string", { kind, connectionString });
}

export interface TableInfo {
  schema: string;
  name: string;
}

export interface TableData {
  columns: string[];
  rows: Record<string, unknown>[];
}

export interface ColumnInfo {
  schema: string;
  table: string;
  name: string;
  data_type: string;
}

export interface QueryResult {
  columns: string[];
  rows: Record<string, string | null>[];
  rows_affected: number | null;
  execution_time_ms: number;
}

export async function listDatabases(
  kind: DatabaseKind,
  connectionString: string,
): Promise<string[]> {
  return invoke("list_databases", { kind, connectionString });
}

export async function listSchemas(
  kind: DatabaseKind,
  connectionString: string,
  database?: string,
): Promise<string[]> {
  return invoke("list_schemas", { kind, connectionString, database });
}

export async function listTables(
  kind: DatabaseKind,
  connectionString: string,
  database?: string,
  schema?: string,
): Promise<TableInfo[]> {
  return invoke("list_tables", { kind, connectionString, database, schema });
}

export async function listAllColumns(
  kind: DatabaseKind,
  connectionString: string,
  database?: string,
): Promise<ColumnInfo[]> {
  return invoke("list_all_columns", { kind, connectionString, database });
}

export type TableRowSort = {
  column: string;
  desc: boolean;
};

export async function fetchTableRows(
  kind: DatabaseKind,
  connectionString: string,
  schema: string,
  table: string,
  filter?: string,
  limit?: number,
  database?: string,
  sort?: TableRowSort,
): Promise<TableData> {
  return invoke("fetch_table_rows", {
    kind,
    connectionString,
    database,
    schema,
    table,
    filter: filter && filter.trim() !== "" ? filter : undefined,
    limit,
    orderBy: sort?.column,
    orderDesc: sort?.desc,
  });
}

export async function countTableRows(
  kind: DatabaseKind,
  connectionString: string,
  schema: string,
  table: string,
  filter?: string,
  database?: string,
): Promise<number> {
  return invoke("count_table_rows", {
    kind,
    connectionString,
    database,
    schema,
    table,
    filter: filter && filter.trim() !== "" ? filter : undefined,
  });
}

export async function updateRow(
  kind: DatabaseKind,
  connectionString: string,
  schema: string,
  table: string,
  ctid: string,
  updates: Record<string, string | null>,
  database?: string,
): Promise<void> {
  await invoke("update_row", {
    kind,
    connectionString,
    database,
    schema,
    table,
    ctid,
    updates,
  });
}

export async function executeQuery(
  kind: DatabaseKind,
  connectionString: string,
  sql: string,
  database?: string,
): Promise<QueryResult> {
  return invoke("execute_query", { kind, connectionString, database, sql });
}
