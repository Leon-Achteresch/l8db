export interface TableInfo {
  schema: string;
  name: string;
}

export interface TableData {
  columns: string[];
  rows: Record<string, unknown>[];
}

export interface RowCount {
  count: number;
  exact: boolean;
  estimate: number | null;
}

export interface ColumnInfo {
  schema: string;
  table: string;
  name: string;
  data_type: string;
}

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rows_affected: number | null;
  execution_time_ms: number;
  notice?: string;
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

export interface ProxyUserInfo {
  name: string;
  category: "user" | "role" | "login";
  bypasses_rls: boolean;
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
