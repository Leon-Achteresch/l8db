import { invoke } from "./core";
import type { DatabaseKind } from "./providers";

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
