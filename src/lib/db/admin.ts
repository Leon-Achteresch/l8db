import { invoke } from "./core";
import type { DatabaseKind } from "./providers";

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

export async function openProxyTunnel(
  request: import("@/lib/ssh").ProxyTunnelRequest,
): Promise<import("@/lib/ssh").SshTunnelInfo> {
  return invoke("open_proxy_tunnel", { request });
}

export async function listSshConfigHosts(): Promise<import("@/lib/ssh").SshConfigHost[]> {
  return invoke("list_ssh_config_hosts");
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
): Promise<import("../../../packages/extension-api/src").ExtensionArchive> {
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

export type ObjectAdminType = "table" | "view" | "materialized_view";

export type ObjectAdminAction = "drop" | "rename";

export interface ObjectDdlRequest {
  schema: string;
  name: string;
  object_type: ObjectAdminType;
  action: ObjectAdminAction;
  cascade: boolean;
  new_name: string | null;
}

export interface ObjectDependent {
  schema: string;
  name: string;
  object_type: string;
}

export interface ObjectAuditInfo {
  schema: string;
  name: string;
  object_type: string;
  owner: string | null;
  size: string | null;
  row_estimate: number | null;
  created_at: string | null;
  changed_at: string | null;
  last_vacuum: string | null;
  last_autovacuum: string | null;
  last_analyze: string | null;
  last_autoanalyze: string | null;
  dependents: ObjectDependent[];
  notes: string[];
}

export async function previewObjectDdl(
  kind: DatabaseKind,
  connectionString: string,
  request: ObjectDdlRequest,
  database?: string,
): Promise<string> {
  return invoke("preview_object_ddl", { kind, connectionString, database, request });
}

export async function executeObjectDdl(
  kind: DatabaseKind,
  connectionString: string,
  request: ObjectDdlRequest,
  database?: string,
): Promise<void> {
  await invoke("execute_object_ddl", { kind, connectionString, database, request });
}

export async function objectAuditInfo(
  kind: DatabaseKind,
  connectionString: string,
  schema: string,
  name: string,
  objectType: ObjectAdminType,
  database?: string,
): Promise<ObjectAuditInfo> {
  return invoke("object_audit_info", {
    kind,
    connectionString,
    database,
    schema,
    name,
    objectType,
  });
}

export type SchemaCopyObjectType = "table" | "view" | "routine" | "package";

export type SchemaCopyStatus = "missing" | "different" | "identical";

export interface SchemaObjectEntry {
  name: string;
  object_type: string;
  status: SchemaCopyStatus;
  source_definition: string;
  target_definition: string;
}

export async function listSchemaCopyObjects(
  kind: DatabaseKind,
  connectionString: string,
  sourceSchema: string,
  targetSchema: string,
  objectType: SchemaCopyObjectType,
  database?: string,
): Promise<SchemaObjectEntry[]> {
  return invoke("list_schema_copy_objects", {
    kind,
    connectionString,
    database,
    sourceSchema,
    targetSchema,
    objectType,
  });
}

export async function previewSchemaObjectCopy(
  kind: DatabaseKind,
  connectionString: string,
  sourceSchema: string,
  targetSchema: string,
  objectType: SchemaCopyObjectType,
  name: string,
  database?: string,
): Promise<string> {
  return invoke("preview_schema_object_copy", {
    kind,
    connectionString,
    database,
    sourceSchema,
    targetSchema,
    objectType,
    name,
  });
}

export async function executeSchemaObjectCopy(
  kind: DatabaseKind,
  connectionString: string,
  sourceSchema: string,
  targetSchema: string,
  objectType: SchemaCopyObjectType,
  name: string,
  database?: string,
): Promise<string> {
  return invoke("execute_schema_object_copy", {
    kind,
    connectionString,
    database,
    sourceSchema,
    targetSchema,
    objectType,
    name,
  });
}

export async function copySchemaTableData(
  kind: DatabaseKind,
  connectionString: string,
  sourceSchema: string,
  targetSchema: string,
  name: string,
  limit: number,
  database?: string,
): Promise<number> {
  return invoke("copy_schema_table_data", {
    kind,
    connectionString,
    database,
    sourceSchema,
    targetSchema,
    name,
    limit,
  });
}
