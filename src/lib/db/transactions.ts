import { invoke, type QueryExecutionOptions } from "./core";
import type { DatabaseKind } from "./providers";
import type { ExtensionInfo, FunctionInfo, QueryResult } from "./types";

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
  options?: QueryExecutionOptions,
): Promise<QueryResult> {
  return invoke("execute_in_transaction", { txId, sql, options });
}

export async function executeInTransactionWithParams(
  txId: string,
  sql: string,
  params: (string | null)[],
  options?: QueryExecutionOptions,
): Promise<QueryResult> {
  return invoke("execute_in_transaction_with_params", { txId, sql, params, options });
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

export interface InvalidObjectInfo {
  schema: string;
  name: string;
  object_type: string;
  status: string;
  oid: string;
}

export interface CompileErrorInfo {
  schema: string;
  name: string;
  object_type: string;
  line: number | null;
  position: number | null;
  message: string;
}

export interface InvalidCompileOutcome {
  schema: string;
  name: string;
  object_type: string;
  oid: string;
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

export async function listInvalidObjects(
  kind: DatabaseKind,
  connectionString: string,
  database?: string,
  schema?: string,
): Promise<InvalidObjectInfo[]> {
  return invoke("list_invalid_objects", { kind, connectionString, database, schema });
}

export async function listCompileErrors(
  kind: DatabaseKind,
  connectionString: string,
  database?: string,
  schema?: string,
): Promise<CompileErrorInfo[]> {
  return invoke("list_compile_errors", { kind, connectionString, database, schema });
}

export async function compileInvalidObjects(
  kind: DatabaseKind,
  connectionString: string,
  database?: string,
  schema?: string,
): Promise<InvalidCompileOutcome[]> {
  return invoke("compile_invalid_objects", { kind, connectionString, database, schema });
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
