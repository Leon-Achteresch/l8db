import type { MaskMode } from "@/lib/masking";
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
  comment?: string | null;
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

export interface CsvImportConflict {
  constraint: string;
  update_columns: string[];
}

export type ImportFormat = "csv" | "json" | "ndjson" | "xlsx" | "parquet";

export interface ImportFileSource {
  path: string;
  delimiter: string;
  quote: string;
  has_header: boolean;
  empty_as_null: boolean;
  indices: number[];
  format?: ImportFormat;
  sheet?: string | null;
  skip_rows?: number;
  keys?: string[];
}

export interface CsvImportRequest {
  file?: ImportFileSource;
  conflict?: CsvImportConflict;
  schema: string;
  table: string;
  columns: string[];
  rows: (string | null)[][];
}

export interface CsvImportOutcome {
  updated_rows?: number;
  skipped_rows?: number;
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
  path: string;
  options: {
    delimiter: string;
    quote: string;
    header: boolean;
    nullText: string;
    lineEnding: string;
    bom: boolean;
  };
  masks: { column: string; mode: MaskMode; text?: string | null }[];
  maxRows?: number | null;
  format?: FileExportFormat;
}

export type FileExportFormat = "csv" | "xml" | "html" | "parquet";

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

export async function readTableSnapshot(
  kind: DatabaseKind,
  connectionString: string,
  database: string | undefined,
  request: {
    schema: string;
    table: string;
    filter?: string;
    allowRawFilter: boolean;
    orderBy?: string;
    orderDesc: boolean;
    isView: boolean;
    maxRows: number;
  },
  options?: QueryExecutionOptions,
): Promise<import("./types").TableData> {
  return invoke("read_table_snapshot", { kind, connectionString, database, request, options });
}

export async function compareTableDataRemote(
  request: {
    left: {
      connectionString: string;
      database: string | null;
      kind: DatabaseKind;
      source: Parameters<typeof readTableSnapshot>[3];
    };
    right: {
      connectionString: string;
      database: string | null;
      kind: DatabaseKind;
      source: Parameters<typeof readTableSnapshot>[3];
    };
    keyColumns: string[];
    compareColumns: string[];
  },
  options?: QueryExecutionOptions,
): Promise<import("@/lib/data-compare").DataCompareResult & { detailsTruncated: boolean }> {
  return invoke("compare_table_data", { request, options });
}

export interface ImportPreview {
  columns: string[];
  rows: (string | null)[][];
  sheets: string[];
  sheet: string | null;
  total_rows: number | null;
  source_types: (string | null)[];
}

export async function readImportPreview(
  path: string,
  format: Exclude<ImportFormat, "csv">,
  options: { sheet?: string | null; skipRows?: number; hasHeader?: boolean } = {},
): Promise<ImportPreview> {
  return invoke("read_import_preview", {
    path,
    format,
    sheet: options.sheet ?? null,
    skipRows: options.skipRows ?? 0,
    hasHeader: options.hasHeader ?? true,
  });
}

export interface RowsExportRequest {
  path: string;
  format: Exclude<FileExportFormat, "csv">;
  columns: string[];
  columnTypes?: string[];
  rows: Record<string, unknown>[];
  masks?: { column: string; mode: MaskMode; text?: string | null }[];
  title?: string | null;
}

export async function exportRowsFile(request: RowsExportRequest): Promise<number> {
  return invoke("export_rows_file", { request });
}

export async function readCsvPreview(path: string): Promise<{ text: string; partial: boolean }> {
  return invoke("read_csv_preview", { path });
}
