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
