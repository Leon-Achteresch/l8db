import { invoke, type QueryExecutionOptions } from "./core";
import type { DatabaseKind } from "./providers";

export interface DetailedColumnInfo {
  name: string;
  data_type: string;
  is_nullable: boolean;
  column_default: string | null;
  is_primary_key: boolean;
  ordinal_position: number;
  character_maximum_length: number | null;
}

export interface ImportColumnInfo {
  name: string;
  data_type: string;
  is_nullable: boolean;
  has_default: boolean;
  is_identity: boolean;
  is_generated: boolean;
  ordinal_position: number;
}

export interface CsvImportRequest {
  schema: string;
  table: string;
  columns: string[];
  rows: (string | null)[][];
}

export interface CsvImportOutcome {
  inserted_rows: number;
  failed_row: number | null;
  failed_column: string | null;
  error: string | null;
}

export async function listImportColumns(
  kind: DatabaseKind,
  connectionString: string,
  schema: string,
  table: string,
  database?: string,
): Promise<ImportColumnInfo[]> {
  return invoke("list_import_columns", { kind, connectionString, database, schema, table });
}

export async function csvImport(
  kind: DatabaseKind,
  connectionString: string,
  request: CsvImportRequest,
  database?: string,
  options?: QueryExecutionOptions,
): Promise<CsvImportOutcome> {
  return invoke("csv_import", { kind, connectionString, database, request, options });
}

export interface TableExportRequest {
  jobId: string;
  schema: string;
  table: string;
  filter?: string | null;
  allowRawFilter: boolean;
  orderBy?: string | null;
  orderDesc: boolean;
  isView: boolean;
  path: string;
  options: {
    delimiter: string;
    quote: string;
    header: boolean;
    nullText: string;
    lineEnding: string;
    bom: boolean;
  };
  masks: { column: string; mode: "text" | "null"; text?: string | null }[];
  maxRows?: number | null;
}

export interface TableExportOutcome {
  rows: number;
  path: string;
  truncated: boolean;
}

export interface TableExportProgress {
  jobId: string;
  rows: number;
}

export async function exportTableCsv(
  kind: DatabaseKind,
  connectionString: string,
  request: TableExportRequest,
  database?: string,
): Promise<TableExportOutcome> {
  return invoke("export_table_csv", { kind, connectionString, database, request });
}

export async function cancelTableExport(jobId: string): Promise<void> {
  return invoke("cancel_table_export", { jobId });
}

export interface AddColumnRequest {
  name: string;
  data_type: string;
  is_nullable: boolean;
  default_value?: string;
}

export interface AlterColumnRequest {
  old_name: string;
  new_name?: string;
  data_type?: string;
  set_not_null?: boolean;
  new_default?: string;
  drop_default: boolean;
}

export async function listTableColumnsDetailed(
  kind: DatabaseKind,
  connectionString: string,
  schema: string,
  table: string,
  database?: string,
): Promise<DetailedColumnInfo[]> {
  return invoke("list_table_columns_detailed", {
    kind,
    connectionString,
    database,
    schema,
    table,
  });
}

export async function addColumn(
  kind: DatabaseKind,
  connectionString: string,
  schema: string,
  table: string,
  column: AddColumnRequest,
  database?: string,
): Promise<void> {
  await invoke("add_column", {
    kind,
    connectionString,
    database,
    schema,
    table,
    column,
  });
}

export async function alterColumn(
  kind: DatabaseKind,
  connectionString: string,
  schema: string,
  table: string,
  changes: AlterColumnRequest,
  database?: string,
): Promise<void> {
  await invoke("alter_column", {
    kind,
    connectionString,
    database,
    schema,
    table,
    changes,
  });
}

export async function dropColumn(
  kind: DatabaseKind,
  connectionString: string,
  schema: string,
  table: string,
  column: string,
  database?: string,
): Promise<void> {
  await invoke("drop_column", {
    kind,
    connectionString,
    database,
    schema,
    table,
    column,
  });
}

export interface SequenceInfo {
  schema: string;
  name: string;
  data_type: string;
  start_value: string;
  min_value: string;
  max_value: string;
  increment_by: string;
  cycle: boolean;
  last_value: string | null;
}

export async function listSequences(
  kind: DatabaseKind,
  connectionString: string,
  database?: string,
  schema?: string,
): Promise<SequenceInfo[]> {
  return invoke("list_sequences", { kind, connectionString, database, schema });
}

export interface AlterSequenceRequest {
  increment_by?: string;
  min_value?: string;
  max_value?: string;
  cycle?: boolean;
  restart_with?: string;
}

export async function alterSequence(
  kind: DatabaseKind,
  connectionString: string,
  schema: string,
  name: string,
  changes: AlterSequenceRequest,
  database?: string,
): Promise<void> {
  await invoke("alter_sequence", { kind, connectionString, database, schema, name, changes });
}
