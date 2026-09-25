import { invoke, type QueryExecutionOptions } from "./core";
import type { DatabaseKind } from "./providers";

export interface IndexInfo {
  name: string;
  is_unique: boolean;
  is_primary: boolean;
  columns: string[];
  index_type: string;
  definition: string;
}

export async function listIndexes(
  kind: DatabaseKind,
  connectionString: string,
  schema: string,
  table: string,
  database?: string,
): Promise<IndexInfo[]> {
  return invoke("list_indexes", { kind, connectionString, database, schema, table });
}

export async function tableComment(
  kind: DatabaseKind,
  connectionString: string,
  schema: string,
  table: string,
  database?: string,
): Promise<string | null> {
  return invoke("table_comment", { kind, connectionString, database, schema, table });
}

export interface ConstraintInfo {
  name: string;
  constraint_type: string;
  columns: string[];
  definition: string;
}

export async function listConstraints(
  kind: DatabaseKind,
  connectionString: string,
  schema: string,
  table: string,
  database?: string,
): Promise<ConstraintInfo[]> {
  return invoke("list_constraints", { kind, connectionString, database, schema, table });
}

export async function installExtension(
  kind: DatabaseKind,
  connectionString: string,
  name: string,
  schema?: string,
  database?: string,
): Promise<void> {
  await invoke("install_extension", { kind, connectionString, database, name, schema });
}

export async function uninstallExtension(
  kind: DatabaseKind,
  connectionString: string,
  name: string,
  database?: string,
): Promise<void> {
  await invoke("uninstall_extension", { kind, connectionString, database, name });
}

export interface AvailableExtensionInfo {
  name: string;
  default_version: string;
  comment: string | null;
  installed: boolean;
}

export async function listAvailableExtensions(
  kind: DatabaseKind,
  connectionString: string,
  database?: string,
): Promise<AvailableExtensionInfo[]> {
  return invoke("list_available_extensions", { kind, connectionString, database });
}

export interface ScriptStatementResult {
  statement: string;
  success: boolean;
  rows_affected: number | null;
  error: string | null;
}

export async function executeScript(
  kind: DatabaseKind,
  connectionString: string,
  sql: string,
  database?: string,
  options?: QueryExecutionOptions,
): Promise<ScriptStatementResult[]> {
  return invoke("execute_script", { kind, connectionString, database, sql, options });
}

export interface ColumnDefinition {
  name: string;
  data_type: string;
  is_nullable: boolean;
  default_value: string | null;
  is_primary_key: boolean;
  is_unique: boolean;
}

export type TableConstraintSpec =
  | { kind: "primary_key"; name: string | null; columns: string[] }
  | { kind: "unique"; name: string | null; columns: string[] }
  | { kind: "check"; name: string | null; expression: string }
  | {
      kind: "foreign_key";
      name: string | null;
      columns: string[];
      ref_schema: string | null;
      ref_table: string;
      ref_columns: string[];
      on_delete: string | null;
      on_update: string | null;
      deferrable: boolean;
      initially_deferred: boolean;
    };

export type ConstraintChange =
  | { action: "add"; constraint: TableConstraintSpec }
  | { action: "drop"; name: string; constraint_type: string };

export interface ColumnValueOptions {
  column: string;
  values: string[];
}

export interface CreateTableRequest {
  schema: string;
  name: string;
  columns: ColumnDefinition[];
  if_not_exists: boolean;
  primary_key_name?: string | null;
  constraints?: TableConstraintSpec[];
}

export async function previewConstraintChange(
  kind: DatabaseKind,
  schema: string,
  table: string,
  change: ConstraintChange,
): Promise<string> {
  return invoke("preview_constraint_change", { kind, schema, table, change });
}

export async function applyConstraintChange(
  kind: DatabaseKind,
  connectionString: string,
  schema: string,
  table: string,
  change: ConstraintChange,
  database?: string,
): Promise<string> {
  return invoke("apply_constraint_change", {
    kind,
    connectionString,
    database,
    schema,
    table,
    change,
  });
}

export async function columnValueOptions(
  kind: DatabaseKind,
  connectionString: string,
  schema: string,
  table: string,
  database?: string,
): Promise<ColumnValueOptions[]> {
  return invoke("column_value_options", { kind, connectionString, database, schema, table });
}

export async function createTable(
  kind: DatabaseKind,
  connectionString: string,
  request: CreateTableRequest,
  database?: string,
): Promise<void> {
  await invoke("create_table", { kind, connectionString, database, request });
}

export async function previewCreateTableDdl(
  kind: DatabaseKind,
  connectionString: string,
  request: CreateTableRequest,
  database?: string,
): Promise<string> {
  return invoke("preview_create_table_ddl", { kind, connectionString, database, request });
}

export interface MatviewInfo {
  schema: string;
  name: string;
  is_populated: boolean;
  definition: string | null;
}

export interface CreateMatviewRequest {
  schema: string;
  name: string;
  query: string;
  with_data: boolean;
}

export async function listMaterializedViews(
  kind: DatabaseKind,
  connectionString: string,
  database?: string,
  schema?: string,
): Promise<MatviewInfo[]> {
  return invoke("list_materialized_views", { kind, connectionString, database, schema });
}

export async function refreshMaterializedView(
  kind: DatabaseKind,
  connectionString: string,
  schema: string,
  name: string,
  concurrently: boolean,
  database?: string,
): Promise<void> {
  await invoke("refresh_materialized_view", {
    kind,
    connectionString,
    database,
    schema,
    name,
    concurrently,
  });
}

export async function dropMaterializedView(
  kind: DatabaseKind,
  connectionString: string,
  schema: string,
  name: string,
  database?: string,
): Promise<void> {
  await invoke("drop_materialized_view", { kind, connectionString, database, schema, name });
}

export async function createMaterializedView(
  kind: DatabaseKind,
  connectionString: string,
  request: CreateMatviewRequest,
  database?: string,
): Promise<void> {
  await invoke("create_materialized_view", { kind, connectionString, database, request });
}

export interface PolicyInfo {
  name: string;
  command: string;
  roles: string[];
  using_expr: string | null;
  check_expr: string | null;
}

export interface TableRlsInfo {
  rls_enabled: boolean;
  force_rls: boolean;
  policies: PolicyInfo[];
}

export interface CreatePolicyRequest {
  name: string;
  command: string;
  roles: string[];
  using_expr?: string;
  check_expr?: string;
}

export async function getTableRls(
  kind: DatabaseKind,
  connectionString: string,
  schema: string,
  table: string,
  database?: string,
): Promise<TableRlsInfo> {
  return invoke("get_table_rls", { kind, connectionString, database, schema, table });
}

export async function setTableRls(
  kind: DatabaseKind,
  connectionString: string,
  schema: string,
  table: string,
  enabled: boolean,
  force: boolean,
  database?: string,
): Promise<void> {
  await invoke("set_table_rls", {
    kind,
    connectionString,
    database,
    schema,
    table,
    enabled,
    force,
  });
}

export async function createPolicy(
  kind: DatabaseKind,
  connectionString: string,
  schema: string,
  table: string,
  policy: CreatePolicyRequest,
  database?: string,
): Promise<void> {
  await invoke("create_policy", { kind, connectionString, database, schema, table, policy });
}

export async function dropPolicy(
  kind: DatabaseKind,
  connectionString: string,
  schema: string,
  table: string,
  name: string,
  database?: string,
): Promise<void> {
  await invoke("drop_policy", { kind, connectionString, database, schema, table, name });
}
