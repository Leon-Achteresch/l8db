import { invoke } from "./core";
import type { DatabaseKind } from "./providers";
import type { ColumnInfo, TableInfo } from "./types";

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

export interface ObjectGrantInfo {
  grantee: string;
  privilege: string;
  grantor: string;
  grantable: boolean;
  column_name: string | null;
}

export async function listObjectGrants(
  kind: DatabaseKind,
  connectionString: string,
  schema: string,
  name: string,
  database?: string,
): Promise<ObjectGrantInfo[]> {
  return invoke("list_object_grants", { kind, connectionString, database, schema, name });
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
