import { invoke, type QueryExecutionOptions } from "./core";
import type { DatabaseKind } from "./providers";
import type { QueryResult, RowCount, TableData, TableInfo } from "./types";

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
  txId?: string,
  options?: QueryExecutionOptions,
): Promise<TableData> {
  return invoke("fetch_table_rows", {
    kind,
    txId,
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
    options,
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
  txId?: string,
  options?: QueryExecutionOptions,
): Promise<number> {
  return invoke("count_table_rows", {
    kind,
    txId,
    connectionString,
    database,
    schema,
    table,
    filter: filter && filter.trim() !== "" ? filter : undefined,
    allowRaw: allowRaw ?? true,
    options,
  });
}

export async function countTableRowsCapped(
  kind: DatabaseKind,
  connectionString: string,
  schema: string,
  table: string,
  cap: number,
  filter?: string,
  database?: string,
  allowRaw?: boolean,
  txId?: string,
  options?: QueryExecutionOptions,
): Promise<RowCount> {
  return invoke("count_table_rows_capped", {
    kind,
    txId,
    connectionString,
    database,
    schema,
    table,
    cap,
    filter: filter && filter.trim() !== "" ? filter : undefined,
    allowRaw: allowRaw ?? true,
    options,
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
  options?: QueryExecutionOptions,
): Promise<QueryResult> {
  return invoke("execute_query", { kind, connectionString, database, sql, options });
}

export async function executeQueryWithParams(
  kind: DatabaseKind,
  connectionString: string,
  sql: string,
  params: (string | null)[],
  database?: string,
  options?: QueryExecutionOptions,
): Promise<QueryResult> {
  return invoke("execute_query_with_params", {
    kind,
    connectionString,
    database,
    sql,
    params,
    options,
  });
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

export async function getTableDdl(
  kind: DatabaseKind,
  connectionString: string,
  schema: string,
  table: string,
  database?: string,
): Promise<string> {
  return invoke("get_table_ddl", {
    kind,
    connectionString,
    database,
    schema,
    table,
  });
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
