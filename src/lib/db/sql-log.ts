import { invoke } from "./core";

export interface SqlLogEntry {
  id: number;
  at_ms: number;
  kind: string;
  source: string;
  sql: string;
  duration_ms: number;
  rows: number | null;
  error: string | null;
}

export interface SqlLogPage {
  enabled: boolean;
  entries: SqlLogEntry[];
}

export async function configureSqlLog(enabled: boolean): Promise<void> {
  return invoke("sql_log_configure", { enabled });
}

export async function readSqlLog(after: number): Promise<SqlLogPage> {
  return invoke("sql_log_entries", { after });
}

export async function clearSqlLog(): Promise<void> {
  return invoke("sql_log_clear");
}
