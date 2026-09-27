import { invoke, type QueryExecutionOptions } from "./core";
import type { DatabaseKind } from "./providers";

export type TableCopyMode = "create" | "truncate" | "append";

export interface TableCopyRequest {
  source: {
    kind: DatabaseKind;
    connectionString: string;
    database: string | null;
    schema: string;
    table: string;
  };
  targetSchema: string;
  targetTable: string;
  mode: TableCopyMode;
  includePrimaryKey: boolean;
  includeIndexes: boolean;
  dryRun?: boolean;
}

export interface TableCopyOutcome {
  rows: number;
  created: boolean;
  statements: string[];
  warnings: string[];
  error: string | null;
}

export interface TableCopyProgress {
  jobId: string;
  rows: number;
}

export async function copyTableToConnection(
  kind: DatabaseKind,
  connectionString: string,
  request: TableCopyRequest,
  database?: string,
  options?: QueryExecutionOptions,
): Promise<TableCopyOutcome> {
  return invoke("copy_table_to_connection", {
    kind,
    connectionString,
    database,
    request,
    options,
  });
}

export interface TransferEndpoint {
  kind: DatabaseKind;
  connectionString: string;
  database: string | null;
}

export interface TransferSchemaPair {
  source: string;
  target: string;
}

export interface TransferStatement {
  sql: string;
  objectType?: string | null;
  schema?: string | null;
  name?: string | null;
}

export interface TransferColumn {
  source: string;
  target: string;
  sourceType: string;
  targetType: string;
  identity: boolean;
}

export interface TransferTable {
  sourceSchema: string;
  sourceName: string;
  targetSchema: string;
  targetName: string;
  columns: TransferColumn[];
  key: string[];
  only: boolean;
}

export interface TransferManualObject {
  objectType: string;
  schema: string;
  name: string;
  reason: string;
  ddl: string;
}

export interface TransferPlan {
  native: boolean;
  atomic: boolean;
  schemas: TransferSchemaPair[];
  createSchemas: string[];
  tables: TransferTable[];
  preData: TransferStatement[];
  beforeLoad: TransferStatement[];
  postData: TransferStatement[];
  finalize: TransferStatement[];
  sequences: {
    sourceSchema: string;
    sourceName: string;
    targetSchema: string;
    targetName: string;
  }[];
  manual: TransferManualObject[];
  warnings: string[];
  conflicts: string[];
}

export interface TransferOutcome {
  tables: { schema: string; name: string; rows: number }[];
  rows: number;
  atomic: boolean;
  committed: boolean;
  rolledBack: boolean;
  leftovers: string[];
  warnings: string[];
  error: string | null;
}

export type TransferPhase = "pre" | "data" | "post" | "finalize";

export interface TransferProgress {
  jobId: string;
  progress: {
    phase: TransferPhase;
    table: string | null;
    tableIndex: number;
    tables: number;
    rows: number;
    totalRows: number;
  };
}

export async function planTransfer(
  kind: DatabaseKind,
  connectionString: string,
  request: { source: TransferEndpoint; schemas: TransferSchemaPair[]; foldNames: boolean },
  database?: string,
): Promise<TransferPlan> {
  return invoke("plan_transfer", { kind, connectionString, database, request });
}

export async function runTransfer(
  kind: DatabaseKind,
  connectionString: string,
  request: { source: TransferEndpoint; plan: TransferPlan },
  database?: string,
  options?: QueryExecutionOptions,
): Promise<TransferOutcome> {
  return invoke("run_transfer", { kind, connectionString, database, request, options });
}
