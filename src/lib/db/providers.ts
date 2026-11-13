import { invoke } from "./core";

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
  | "odbc"
  | "elasticsearch"
  | "influxdb"
  | "sqlite_http"
  | "dynamodb"
  | "athena"
  | "bigquery"
  | "snowflake"
  | "s3"
  | "jdbc"
  | "workspace"
  | "spacetimedb";

export interface Capabilities {
  databases: boolean;
  schemas: boolean;
  views: boolean;
  view_editor: boolean;
  materialized_views: boolean;
  functions: boolean;
  extensions: boolean;
  roles: boolean;
  principals: boolean;
  privileges: boolean;
  sequences: boolean;
  enums: boolean;
  triggers: boolean;
  indexes: boolean;
  constraints: boolean;
  foreign_keys: boolean;
  rls: boolean;
  proxy_user: boolean;
  partitions: boolean;
  replication: boolean;
  sessions: boolean;
  locks: boolean;
  live_monitor: boolean;
  transactions: boolean;
  table_transactions: boolean;
  row_edit: boolean;
  ddl: boolean;
  alter_columns: boolean;
  explain: boolean;
  query_stats: boolean;
  overview: boolean;
  sql_filter: boolean;
  read_only_mode: boolean;
  csv_import: boolean;
  import_conflicts: boolean;
  table_copy: boolean;
  test_data: boolean;
  column_search: boolean;
  source_search: boolean;
  schema_snapshot: boolean;
  full_table_export: boolean;
  data_compare: boolean;
  procedures: boolean;
  compile_objects: boolean;
  invalid_objects: boolean;
  debugger: boolean;
  bind_parameters: boolean;
  used_by: boolean;
  object_grants: boolean;
  synonyms: boolean;
  scheduler_jobs: boolean;
  object_admin: boolean;
  schema_object_copy: boolean;
  table_script: boolean;
  migration_script: boolean;
  server_output: boolean;
  query_cancel: boolean;
  server_info: boolean;
  dashboard_parallelism: number;
  ssl: boolean;
  ssh: boolean;
  backup: boolean;
  object_storage: boolean;
  health_advisor: boolean;
  dml_preview: boolean;
  multi_target_query: boolean;
  multi_target_schemas: boolean;
  explain_analyze: boolean;
  packages: boolean;
  insert_sql: boolean;
  database_is_schema: boolean;
  query_language: "sql" | "cql" | "json" | "redis";
  query_label: string;
  filter_hint: string;
  table_template: TableTemplate;
  terms: Terms;
}

export interface TableTemplate {
  schema: string;
  id_type: string;
  timestamp_type: string;
  now: string;
  types: string[];
}

export interface Terms {
  database: string;
  schema: string;
  table: string;
  tables: string;
  row: string;
  rows: string;
  column: string;
  columns: string;
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

export interface TnsNames {
  path: string | null;
  aliases: string[];
}

export function oracleTnsNames(): Promise<TnsNames> {
  return invoke("oracle_tns_names");
}

export function openTnsNames(): Promise<void> {
  return invoke("oracle_open_tnsnames");
}

export async function installDriver(kind: DatabaseKind): Promise<string> {
  return invoke("install_driver", { kind });
}

export interface DriverFinding {
  level: "ok" | "warn" | "error";
  title: string;
  detail: string;
}

export interface DriverDiagnosis {
  status: DriverStatus;
  findings: DriverFinding[];
  steps: string[];
  manual: string | null;
}

export interface DriverRepair {
  log: string;
  diagnosis: DriverDiagnosis;
}

export function diagnoseDriver(kind: DatabaseKind): Promise<DriverDiagnosis> {
  return invoke("diagnose_driver", { kind });
}

export function repairDriver(kind: DatabaseKind): Promise<DriverRepair> {
  return invoke("repair_driver", { kind });
}

export type SslMode = "disable" | "prefer" | "require" | "verify-ca" | "verify-full";

export async function testConnectionString(
  kind: DatabaseKind,
  connectionString: string,
): Promise<void> {
  await invoke("test_connection_string", { kind, connectionString });
}
