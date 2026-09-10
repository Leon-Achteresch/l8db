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

export interface FunctionInfo {
  schema: string;
  name: string;
  identity_args: string;
  return_type: string;
  language: string;
  oid: string;
}

export interface ExtensionInfo {
  name: string;
  version: string | null;
  schema: string | null;
  description: string | null;
}

export interface ForeignKeyInfo {
  constraint_name: string;
  from_schema: string;
  from_table: string;
  from_column: string;
  to_schema: string;
  to_table: string;
  to_column: string;
}

export interface TriggerInfo {
  trigger_name: string;
  table_schema: string;
  table_name: string;
  event: string;
  timing: string;
  orientation: string;
  function_schema: string;
  function_name: string;
  enabled: string;
  definition: string;
}

export interface ERColumn {
  name: string;
  data_type: string;
  is_primary_key: boolean;
  is_nullable: boolean;
}

export interface ERTable {
  schema: string;
  name: string;
  columns: ERColumn[];
}

export interface ERSchema {
  tables: ERTable[];
  foreign_keys: ForeignKeyInfo[];
}

export interface RoleInfo {
  name: string;
  oid: string;
  superuser: boolean;
  can_login: boolean;
  create_db: boolean;
  create_role: boolean;
  replication: boolean;
  bypass_rls: boolean;
  conn_limit: number;
  valid_until: string | null;
  member_of: string[];
  members: string[];
}

export interface CreateRoleOptions {
  name: string;
  password?: string;
  superuser: boolean;
  can_login: boolean;
  create_db: boolean;
  create_role: boolean;
  replication: boolean;
  bypass_rls: boolean;
  conn_limit?: number;
  valid_until?: string;
  member_of: string[];
}

export interface AlterRoleOptions {
  name: string;
  password?: string;
  superuser?: boolean;
  can_login?: boolean;
  create_db?: boolean;
  create_role?: boolean;
  replication?: boolean;
  bypass_rls?: boolean;
  conn_limit?: number;
  valid_until?: string;
  clear_valid_until: boolean;
  grant_roles: string[];
  revoke_roles: string[];
}

export interface TablePrivileges {
  schema: string;
  table: string;
  object_type: string;
  select: boolean;
  insert: boolean;
  update: boolean;
  delete: boolean;
  truncate: boolean;
  references: boolean;
  trigger: boolean;
}

export interface SchemaPrivileges {
  schema: string;
  usage: boolean;
  create: boolean;
}

export interface RolePrivileges {
  schemas: SchemaPrivileges[];
  tables: TablePrivileges[];
}

export interface PrivilegeChange {
  grant: boolean;
  privilege: string;
  object_type: string;
  schema?: string;
  table?: string;
  role_name: string;
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
  schema?: string,
  tableType?: string,
): Promise<ColumnInfo[]> {
  return invoke("list_all_columns", { kind, connectionString, database, schema, tableType });
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
  offset?: number,
  database?: string,
  sort?: TableRowSort,
  isView?: boolean,
): Promise<TableData> {
  return invoke("fetch_table_rows", {
    kind,
    connectionString,
    database,
    schema,
    table,
    filter: filter && filter.trim() !== "" ? filter : undefined,
    limit,
    offset,
    orderBy: sort?.column,
    orderDesc: sort?.desc,
    isView: isView || undefined,
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

export async function listViews(
  kind: DatabaseKind,
  connectionString: string,
  database?: string,
  schema?: string,
): Promise<TableInfo[]> {
  return invoke("list_views", { kind, connectionString, database, schema });
}

export async function getViewDefinition(
  kind: DatabaseKind,
  connectionString: string,
  schema: string,
  view: string,
  database?: string,
): Promise<string> {
  return invoke("get_view_definition", {
    kind,
    connectionString,
    database,
    schema,
    view,
  });
}

export async function updateViewDefinition(
  kind: DatabaseKind,
  connectionString: string,
  schema: string,
  view: string,
  body: string,
  dryRun: boolean,
  database?: string,
): Promise<void> {
  await invoke("update_view_definition", {
    kind,
    connectionString,
    database,
    schema,
    view,
    body,
    dryRun,
  });
}

export async function beginTransaction(
  kind: DatabaseKind,
  connectionString: string,
  database?: string,
): Promise<string> {
  return invoke("begin_transaction", { kind, connectionString, database });
}

export async function executeInTransaction(
  txId: string,
  sql: string,
): Promise<QueryResult> {
  return invoke("execute_in_transaction", { txId, sql });
}

export async function updateRowInTransaction(
  txId: string,
  schema: string,
  table: string,
  ctid: string,
  updates: Record<string, string | null>,
): Promise<string> {
  return invoke("update_row_in_transaction", { txId, schema, table, ctid, updates });
}

export async function insertRowInTransaction(
  txId: string,
  schema: string,
  table: string,
  values: Record<string, string | null>,
): Promise<Record<string, unknown>> {
  return invoke("insert_row_in_transaction", { txId, schema, table, values });
}

export async function duplicateRowInTransaction(
  txId: string,
  schema: string,
  table: string,
  ctid: string,
): Promise<Record<string, unknown>> {
  return invoke("duplicate_row_in_transaction", { txId, schema, table, ctid });
}

export async function deleteRowInTransaction(
  txId: string,
  schema: string,
  table: string,
  ctid: string,
): Promise<void> {
  await invoke("delete_row_in_transaction", { txId, schema, table, ctid });
}

export async function commitTransaction(txId: string): Promise<void> {
  await invoke("commit_transaction", { txId });
}

export async function rollbackTransaction(txId: string): Promise<void> {
  await invoke("rollback_transaction", { txId });
}

export async function listTransactions(): Promise<string[]> {
  return invoke("list_transactions");
}

export async function listFunctions(
  kind: DatabaseKind,
  connectionString: string,
  database?: string,
  schema?: string,
): Promise<FunctionInfo[]> {
  return invoke("list_functions", { kind, connectionString, database, schema });
}

export async function getFunctionDefinition(
  kind: DatabaseKind,
  connectionString: string,
  oid: string,
  database?: string,
): Promise<string> {
  return invoke("get_function_definition", {
    kind,
    connectionString,
    database,
    oid,
  });
}

export async function listExtensions(
  kind: DatabaseKind,
  connectionString: string,
  database?: string,
): Promise<ExtensionInfo[]> {
  return invoke("list_extensions", { kind, connectionString, database });
}

export async function validateSql(
  kind: DatabaseKind,
  connectionString: string,
  sql: string,
  database?: string,
): Promise<void> {
  await invoke("validate_sql", { kind, connectionString, database, sql });
}

export async function listRoles(
  kind: DatabaseKind,
  connectionString: string,
  database?: string,
): Promise<RoleInfo[]> {
  return invoke("list_roles", { kind, connectionString, database });
}

export async function createRole(
  kind: DatabaseKind,
  connectionString: string,
  options: CreateRoleOptions,
  database?: string,
): Promise<void> {
  await invoke("create_role", { kind, connectionString, database, options });
}

export async function alterRole(
  kind: DatabaseKind,
  connectionString: string,
  options: AlterRoleOptions,
  database?: string,
): Promise<void> {
  await invoke("alter_role", { kind, connectionString, database, options });
}

export async function dropRole(
  kind: DatabaseKind,
  connectionString: string,
  name: string,
  database?: string,
): Promise<void> {
  await invoke("drop_role", { kind, connectionString, database, name });
}

export async function listRolePrivileges(
  kind: DatabaseKind,
  connectionString: string,
  roleName: string,
  database?: string,
): Promise<RolePrivileges> {
  return invoke("list_role_privileges", {
    kind,
    connectionString,
    database,
    roleName,
  });
}

export async function modifyPrivilege(
  kind: DatabaseKind,
  connectionString: string,
  change: PrivilegeChange,
  database?: string,
): Promise<void> {
  await invoke("modify_privilege", {
    kind,
    connectionString,
    database,
    change,
  });
}

export async function listForeignKeys(
  kind: DatabaseKind,
  connectionString: string,
  schema: string,
  table: string,
  database?: string,
): Promise<ForeignKeyInfo[]> {
  return invoke("list_foreign_keys", {
    kind,
    connectionString,
    database,
    schema,
    table,
  });
}

export async function getErSchema(
  kind: DatabaseKind,
  connectionString: string,
  database?: string,
  schema?: string,
): Promise<ERSchema> {
  return invoke("get_er_schema", {
    kind,
    connectionString,
    database,
    schema,
  });
}

export async function listTriggers(
  kind: DatabaseKind,
  connectionString: string,
  schema: string,
  table: string,
  database?: string,
): Promise<TriggerInfo[]> {
  return invoke("list_triggers", {
    kind,
    connectionString,
    database,
    schema,
    table,
  });
}

export async function dropTable(
  kind: DatabaseKind,
  connectionString: string,
  schema: string,
  table: string,
  database?: string,
): Promise<void> {
  await invoke("drop_table", {
    kind,
    connectionString,
    database,
    schema,
    table,
  });
}

export async function truncateTable(
  kind: DatabaseKind,
  connectionString: string,
  schema: string,
  table: string,
  database?: string,
): Promise<void> {
  await invoke("truncate_table", {
    kind,
    connectionString,
    database,
    schema,
    table,
  });
}

export interface DetailedColumnInfo {
  name: string;
  data_type: string;
  is_nullable: boolean;
  column_default: string | null;
  is_primary_key: boolean;
  ordinal_position: number;
  character_maximum_length: number | null;
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
