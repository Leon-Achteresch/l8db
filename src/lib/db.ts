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

export async function listTables(
  kind: DatabaseKind,
  connectionString: string,
): Promise<TableInfo[]> {
  return invoke("list_tables", { kind, connectionString });
}

export async function fetchTableRows(
  kind: DatabaseKind,
  connectionString: string,
  schema: string,
  table: string,
  limit?: number,
): Promise<TableData> {
  return invoke("fetch_table_rows", {
    kind,
    connectionString,
    schema,
    table,
    limit,
  });
}
