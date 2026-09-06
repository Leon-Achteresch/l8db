import { invoke as tauriInvoke } from "@tauri-apps/api/core";

const WRITE_COMMANDS = new Set([
  "add_column",
  "alter_column",
  "alter_role",
  "alter_sequence",
  "attach_partition",
  "begin_transaction",
  "cancel_session",
  "compile_object",
  "create_materialized_view",
  "create_policy",
  "create_publication",
  "create_role",
  "create_schema",
  "create_subscription",
  "create_table",
  "csv_import",
  "delete_row_in_transaction",
  "detach_partition",
  "drop_column",
  "drop_materialized_view",
  "drop_policy",
  "drop_publication",
  "drop_role",
  "drop_schema",
  "drop_subscription",
  "drop_table",
  "duplicate_row_in_transaction",
  "execute_in_transaction",
  "execute_in_transaction_with_params",
  "insert_row_in_transaction",
  "install_extension",
  "modify_privilege",
  "refresh_materialized_view",
  "run_scheduler_job",
  "set_scheduler_job_enabled",
  "set_table_rls",
  "terminate_session",
  "truncate_table",
  "uninstall_extension",
  "update_row",
  "update_row_in_transaction",
  "update_view_definition",
]);

export const READ_ONLY_MESSAGE =
  "Lesemodus: Diese Verbindung ist schreibgeschützt. Modus in den Verbindungseinstellungen ändern und neu verbinden.";

let readOnlyResolver: () => boolean = () => false;

export function registerReadOnlyResolver(resolver: () => boolean): void {
  readOnlyResolver = resolver;
}

export function isReadOnlyActive(): boolean {
  try {
    return readOnlyResolver();
  } catch {
    return false;
  }
}

function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (WRITE_COMMANDS.has(command) && isReadOnlyActive()) {
    return Promise.reject(new Error(READ_ONLY_MESSAGE));
  }
  return tauriInvoke<T>(command, args);
}

export type DatabaseKind =
  | "postgres"
  | "mysql"
  | "sqlite"
  | "mssql"
  | "clickhouse"
  | "mongodb"
  | "redis"
  | "oracle"
  | "cassandra"
  | "duckdb"
  | "odbc";

export interface Capabilities {
  databases: boolean;
  schemas: boolean;
  views: boolean;
  view_editor: boolean;
  materialized_views: boolean;
  functions: boolean;
  extensions: boolean;
  roles: boolean;
  privileges: boolean;
  sequences: boolean;
  enums: boolean;
  triggers: boolean;
  indexes: boolean;
  constraints: boolean;
  foreign_keys: boolean;
  rls: boolean;
  partitions: boolean;
  replication: boolean;
  sessions: boolean;
  locks: boolean;
  transactions: boolean;
  row_edit: boolean;
  ddl: boolean;
  alter_columns: boolean;
  explain: boolean;
  overview: boolean;
  sql_filter: boolean;
  read_only_mode: boolean;
  csv_import: boolean;
  column_search: boolean;
  source_search: boolean;
  schema_snapshot: boolean;
  full_table_export: boolean;
  data_compare: boolean;
  procedures: boolean;
  compile_objects: boolean;
  debugger: boolean;
  bind_parameters: boolean;
  used_by: boolean;
  synonyms: boolean;
  scheduler_jobs: boolean;
  server_output: boolean;
  ssl: boolean;
  ssh: boolean;
  query_language: "sql" | "cql" | "json" | "redis";
  filter_hint: string;
}

export type Driver =
  | { type: "builtin" }
  | { type: "runtime_library"; library: string }
  | { type: "odbc"; driver: string }
  | { type: "cargo_feature"; feature: string };

export interface InstallHint {
  os: string;
  command: string;
  url: string;
}

export interface DriverStatus {
  available: boolean;
  detail: string;
  install: InstallHint[];
  install_command: string | null;
}

export interface ProviderInfo {
  id: string;
  name: string;
  group: string;
  kind: DatabaseKind;
  default_port: number | null;
  file_based: boolean;
  url_schemes: string[];
  placeholder: string;
  hint: string;
  hosts: string[];
  driver: Driver;
  capabilities: Capabilities;
  driver_status: DriverStatus;
}

export function listProviders(): Promise<ProviderInfo[]> {
  return invoke("list_providers");
}

export function driverStatus(kind: DatabaseKind): Promise<DriverStatus> {
  return invoke("driver_status", { kind });
}

export async function installDriver(kind: DatabaseKind): Promise<string> {
  return invoke("install_driver", { kind });
}

export type SslMode = "disable" | "prefer" | "require" | "verify-ca" | "verify-full";

export interface ConnectionConfig {
  kind: DatabaseKind;
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl_mode?: SslMode;
  read_only?: boolean;
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

export interface ColumnMatch {
  schema: string;
  table: string;
  column: string;
  data_type: string;
  object_type: string;
}

export interface SourceMatch {
  schema: string;
  name: string;
  oid: string;
  identity: string;
  object_type: string;
  line: number;
  snippet: string;
  occurrences: number;
}

export async function searchColumns(
  kind: DatabaseKind,
  connectionString: string,
  term: string,
  database?: string,
  schema?: string,
  limit?: number,
): Promise<ColumnMatch[]> {
  return invoke("search_columns", { kind, connectionString, database, schema, term, limit });
}

export async function searchSource(
  kind: DatabaseKind,
  connectionString: string,
  term: string,
  database?: string,
  schema?: string,
  limit?: number,
): Promise<SourceMatch[]> {
  return invoke("search_source", { kind, connectionString, database, schema, term, limit });
}

export interface DependencyInfo {
  owner: string;
  name: string;
  object_type: string;
  status: string;
  relation: string;
  oid: string;
  detail: string;
}

export interface SynonymInfo {
  owner: string;
  name: string;
  target_owner: string;
  target_name: string;
  target_type: string;
  db_link: string | null;
  status: string;
}

export interface SchedulerJobInfo {
  id: string;
  owner: string;
  name: string;
  enabled: boolean;
  state: string;
  schedule: string;
  command: string;
  last_run: string | null;
  last_status: string | null;
  last_error: string | null;
  next_run: string | null;
}

export async function listUsedBy(
  kind: DatabaseKind,
  connectionString: string,
  schema: string,
  name: string,
  database?: string,
): Promise<DependencyInfo[]> {
  return invoke("list_used_by", { kind, connectionString, database, schema, name });
}

export async function listSynonyms(
  kind: DatabaseKind,
  connectionString: string,
  database?: string,
  schema?: string,
): Promise<SynonymInfo[]> {
  return invoke("list_synonyms", { kind, connectionString, database, schema });
}

export async function listSchedulerJobs(
  kind: DatabaseKind,
  connectionString: string,
  database?: string,
): Promise<SchedulerJobInfo[]> {
  return invoke("list_scheduler_jobs", { kind, connectionString, database });
}

export async function setSchedulerJobEnabled(
  kind: DatabaseKind,
  connectionString: string,
  jobId: string,
  enabled: boolean,
  database?: string,
): Promise<void> {
  return invoke("set_scheduler_job_enabled", {
    kind,
    connectionString,
    database,
    jobId,
    enabled,
  });
}

export async function runSchedulerJob(
  kind: DatabaseKind,
  connectionString: string,
  jobId: string,
  database?: string,
): Promise<void> {
  return invoke("run_scheduler_job", { kind, connectionString, database, jobId });
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
  allowRaw?: boolean,
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
    allowRaw: allowRaw ?? true,
  });
}

export async function countTableRows(
  kind: DatabaseKind,
  connectionString: string,
  schema: string,
  table: string,
  filter?: string,
  database?: string,
  allowRaw?: boolean,
): Promise<number> {
  return invoke("count_table_rows", {
    kind,
    connectionString,
    database,
    schema,
    table,
    filter: filter && filter.trim() !== "" ? filter : undefined,
    allowRaw: allowRaw ?? true,
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

export async function executeQueryWithParams(
  kind: DatabaseKind,
  connectionString: string,
  sql: string,
  params: (string | null)[],
  database?: string,
): Promise<QueryResult> {
  return invoke("execute_query_with_params", { kind, connectionString, database, sql, params });
}

export interface ExplainPlan {
  Plan?: ExplainNode;
  [key: string]: unknown;
}

export interface ExplainNode {
  "Node Type": string;
  "Relation Name"?: string;
  Alias?: string;
  "Startup Cost": number;
  "Total Cost": number;
  "Plan Rows": number;
  "Plan Width": number;
  "Actual Startup Time"?: number;
  "Actual Total Time"?: number;
  "Actual Rows"?: number;
  "Actual Loops"?: number;
  "Shared Hit Blocks"?: number;
  "Shared Read Blocks"?: number;
  "Index Name"?: string;
  "Index Cond"?: string;
  Filter?: string;
  "Hash Cond"?: string;
  "Join Type"?: string;
  "Sort Key"?: string[];
  "Group Key"?: string[];
  Plans?: ExplainNode[];
  [key: string]: unknown;
}

export async function explainQuery(
  kind: DatabaseKind,
  connectionString: string,
  sql: string,
  analyze: boolean,
  database?: string,
): Promise<ExplainPlan[]> {
  return invoke("explain_query", { kind, connectionString, database, sql, analyze });
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

export async function executeInTransaction(txId: string, sql: string): Promise<QueryResult> {
  return invoke("execute_in_transaction", { txId, sql });
}

export async function executeInTransactionWithParams(
  txId: string,
  sql: string,
  params: (string | null)[],
): Promise<QueryResult> {
  return invoke("execute_in_transaction_with_params", { txId, sql, params });
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

export interface CompileResult {
  status: string;
  message: string | null;
  line: number | null;
  position: number | null;
}

export interface DebugSessionInfo {
  available: boolean;
  message: string;
}

export async function listProcedures(
  kind: DatabaseKind,
  connectionString: string,
  database?: string,
  schema?: string,
): Promise<FunctionInfo[]> {
  return invoke("list_procedures", { kind, connectionString, database, schema });
}

export async function compileObject(
  kind: DatabaseKind,
  connectionString: string,
  oid: string,
  objectType: string,
  database?: string,
): Promise<CompileResult> {
  return invoke("compile_object", { kind, connectionString, database, oid, objectType });
}

export async function startDebugSession(
  kind: DatabaseKind,
  connectionString: string,
  oid: string,
  objectType: string,
  database?: string,
): Promise<DebugSessionInfo> {
  return invoke("start_debug_session", { kind, connectionString, database, oid, objectType });
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
): Promise<CsvImportOutcome> {
  return invoke("csv_import", { kind, connectionString, database, request });
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
): Promise<ScriptStatementResult[]> {
  return invoke("execute_script", { kind, connectionString, database, sql });
}

export interface ColumnDefinition {
  name: string;
  data_type: string;
  is_nullable: boolean;
  default_value: string | null;
  is_primary_key: boolean;
  is_unique: boolean;
}

export interface CreateTableRequest {
  schema: string;
  name: string;
  columns: ColumnDefinition[];
  if_not_exists: boolean;
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

export interface PartitionChild {
  schema: string;
  name: string;
}

export interface PartitionInfo {
  is_partitioned: boolean;
  strategy: string | null;
  partition_key: string | null;
  partitions: PartitionChild[];
}

export async function getPartitionInfo(
  kind: DatabaseKind,
  connectionString: string,
  schema: string,
  table: string,
  database?: string,
): Promise<PartitionInfo> {
  return invoke("get_partition_info", { kind, connectionString, database, schema, table });
}

export async function detachPartition(
  kind: DatabaseKind,
  connectionString: string,
  parentSchema: string,
  parentTable: string,
  childSchema: string,
  childTable: string,
  database?: string,
): Promise<void> {
  await invoke("detach_partition", {
    kind,
    connectionString,
    database,
    parentSchema,
    parentTable,
    childSchema,
    childTable,
  });
}

export async function attachPartition(
  kind: DatabaseKind,
  connectionString: string,
  parentSchema: string,
  parentTable: string,
  childSchema: string,
  childTable: string,
  bound: string,
  database?: string,
): Promise<void> {
  await invoke("attach_partition", {
    kind,
    connectionString,
    database,
    parentSchema,
    parentTable,
    childSchema,
    childTable,
    bound,
  });
}

export interface PublicationInfo {
  name: string;
  owner: string;
  all_tables: boolean;
  insert: boolean;
  update: boolean;
  delete: boolean;
  truncate: boolean;
  tables: string[];
}

export interface CreatePublicationRequest {
  name: string;
  for_all_tables: boolean;
  tables: { schema: string; table: string }[];
  publish_insert: boolean;
  publish_update: boolean;
  publish_delete: boolean;
  publish_truncate: boolean;
}

export async function listPublications(
  kind: DatabaseKind,
  connectionString: string,
  database?: string,
): Promise<PublicationInfo[]> {
  return invoke("list_publications", { kind, connectionString, database });
}

export async function createPublication(
  kind: DatabaseKind,
  connectionString: string,
  request: CreatePublicationRequest,
  database?: string,
): Promise<void> {
  await invoke("create_publication", { kind, connectionString, database, request });
}

export async function dropPublication(
  kind: DatabaseKind,
  connectionString: string,
  name: string,
  database?: string,
): Promise<void> {
  await invoke("drop_publication", { kind, connectionString, database, name });
}

export interface SubscriptionInfo {
  name: string;
  enabled: boolean;
  connection_string: string;
  slot_name: string | null;
  publications: string[];
}

export interface CreateSubscriptionRequest {
  name: string;
  connection_string: string;
  publications: string[];
  slot_name?: string;
  enabled: boolean;
  connect: boolean;
}

export async function listSubscriptions(
  kind: DatabaseKind,
  connectionString: string,
  database?: string,
): Promise<SubscriptionInfo[]> {
  return invoke("list_subscriptions", { kind, connectionString, database });
}

export async function createSubscription(
  kind: DatabaseKind,
  connectionString: string,
  request: CreateSubscriptionRequest,
  database?: string,
): Promise<void> {
  await invoke("create_subscription", { kind, connectionString, database, request });
}

export async function dropSubscription(
  kind: DatabaseKind,
  connectionString: string,
  name: string,
  database?: string,
): Promise<void> {
  await invoke("drop_subscription", { kind, connectionString, database, name });
}

export interface SessionInfo {
  pid: number;
  user: string;
  database: string;
  application: string;
  client_addr: string | null;
  state: string | null;
  query: string;
  query_start: string | null;
  transaction_start: string | null;
  wait_event: string | null;
  is_self: boolean;
  blocked_by: number[];
}

export async function listSessions(
  kind: DatabaseKind,
  connectionString: string,
  database?: string,
): Promise<SessionInfo[]> {
  return invoke("list_sessions", { kind, connectionString, database });
}

export async function cancelSession(
  kind: DatabaseKind,
  connectionString: string,
  pid: number,
  database?: string,
): Promise<boolean> {
  return invoke("cancel_session", { kind, connectionString, database, pid });
}

export async function terminateSession(
  kind: DatabaseKind,
  connectionString: string,
  pid: number,
  database?: string,
): Promise<boolean> {
  return invoke("terminate_session", { kind, connectionString, database, pid });
}

export interface LockInfo {
  pid: number;
  lock_type: string;
  relation: string | null;
  mode: string;
  granted: boolean;
}

export async function listLocks(
  kind: DatabaseKind,
  connectionString: string,
  database?: string,
): Promise<LockInfo[]> {
  return invoke("list_locks", { kind, connectionString, database });
}

export interface EnumInfo {
  schema: string;
  name: string;
  values: string[];
}

export async function listEnums(
  kind: DatabaseKind,
  connectionString: string,
  database?: string,
  schema?: string,
): Promise<EnumInfo[]> {
  return invoke("list_enums", { kind, connectionString, database, schema });
}

export async function createSchema(
  kind: DatabaseKind,
  connectionString: string,
  name: string,
  database?: string,
): Promise<void> {
  await invoke("create_schema", { kind, connectionString, database, name });
}

export async function dropSchema(
  kind: DatabaseKind,
  connectionString: string,
  name: string,
  cascade: boolean,
  database?: string,
): Promise<void> {
  await invoke("drop_schema", { kind, connectionString, database, name, cascade });
}

export interface SchemaSize {
  schema: string;
  table_count: number;
  size_bytes: number;
}

export interface DatabaseOverview {
  database: string;
  size_bytes: number;
  size_pretty: string;
  schemas: SchemaSize[];
}

export async function getDatabaseOverview(
  kind: DatabaseKind,
  connectionString: string,
  database?: string,
): Promise<DatabaseOverview> {
  return invoke("get_database_overview", { kind, connectionString, database });
}

export async function storeSecret(account: string, secret: string): Promise<void> {
  await invoke("store_secret", { account, secret });
}

export async function loadSecret(account: string): Promise<string | null> {
  return invoke("load_secret", { account });
}

export async function deleteSecret(account: string): Promise<void> {
  await invoke("delete_secret", { account });
}

export async function openSshTunnel(
  request: import("@/lib/ssh").SshTunnelRequest,
): Promise<import("@/lib/ssh").SshTunnelInfo> {
  return invoke("open_ssh_tunnel", { request });
}

export async function closeSshTunnel(id: string): Promise<void> {
  await invoke("close_ssh_tunnel", { id });
}

export async function listSshTunnels(): Promise<import("@/lib/ssh").SshTunnelInfo[]> {
  return invoke("list_ssh_tunnels");
}

export function communityExtensionStore<T>(
  operation: string,
  id = "",
  value: unknown = null,
): Promise<T> {
  return invoke("community_extension_store", { operation, id, value });
}

export function readCommunityExtension(
  path: string,
  development = false,
): Promise<import("../../packages/extension-api/src").ExtensionArchive> {
  return invoke("read_community_extension", { path, development });
}

export interface ServerMessage {
  level: string;
  message: string;
  detail?: string | null;
}

export async function setServerOutput(
  kind: DatabaseKind,
  connectionString: string,
  enabled: boolean,
  database?: string,
): Promise<void> {
  return invoke("set_server_output", { kind, connectionString, database, enabled });
}

export async function takeServerOutput(
  kind: DatabaseKind,
  connectionString: string,
  database?: string,
): Promise<ServerMessage[]> {
  return invoke("take_server_output", { kind, connectionString, database });
}
