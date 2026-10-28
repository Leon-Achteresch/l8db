import { invoke } from "./core";

export interface SupabaseSqlResult {
  columns: string[];
  rows: Record<string, unknown>[];
  row_count: number;
  truncated: boolean;
  duration_ms: number;
  statement_count: number;
  read_only: boolean;
}

export const supabaseStudioSqlRun = (reference: string, query: string, readOnly: boolean) =>
  invoke<SupabaseSqlResult>("supabase_studio_sql_run", { reference, query, readOnly });
