import { invoke } from "./core";

export type DatabaseListKind =
  | "schemas"
  | "views"
  | "functions"
  | "triggers"
  | "indexes"
  | "enums"
  | "extensions"
  | "roles"
  | "publications"
  | "publication_tables"
  | "sequences"
  | "rls_tables"
  | "policies";

export interface DatabaseListPage<T> {
  items: T[];
  has_more: boolean;
}

export interface DbSchema {
  name: string;
  owner: string;
  table_count: number;
  protected: boolean;
}

export interface DbView {
  oid: number;
  schema: string;
  name: string;
  materialized: boolean;
  populated: boolean;
  comment: string | null;
}

export interface DbFunction {
  oid: number;
  schema: string;
  name: string;
  arguments: string;
  return_type: string | null;
  language: string;
  security_definer: boolean;
  is_procedure: boolean;
}

export interface DbTrigger {
  oid: number;
  schema: string;
  table_name: string;
  name: string;
  enabled: boolean;
  definition: string;
  function_oid: number;
  function_name: string;
}

export interface DbIndex {
  oid: number;
  schema: string;
  table_name: string;
  name: string;
  definition: string;
  method: string;
  is_unique: boolean;
  is_primary: boolean;
  is_valid: boolean;
  is_constraint: boolean;
  size_bytes: number;
  size: string;
  scans: number;
}

export interface DbEnum {
  oid: number;
  schema: string;
  name: string;
  enum_values: string[];
}

export interface DbExtension {
  name: string;
  default_version: string | null;
  installed_version: string | null;
  schema: string | null;
  comment: string | null;
}

export interface DbRoleAttributes {
  login: boolean;
  inherit: boolean;
  createdb: boolean;
  createrole: boolean;
  bypassrls: boolean;
  connection_limit: number;
}

export interface DbRole extends DbRoleAttributes {
  oid: number;
  name: string;
  superuser: boolean;
  replication: boolean;
  valid_until: string | null;
  member_of: string[];
  protected: boolean;
}

export interface DbPublication {
  oid: number;
  name: string;
  owner: string;
  all_tables: boolean;
  publish_insert: boolean;
  publish_update: boolean;
  publish_delete: boolean;
  publish_truncate: boolean;
  table_count: number;
}

export interface DbPublicationTable {
  schema: string;
  name: string;
}

export interface DbSequence {
  schema: string;
  name: string;
  data_type: string;
  start_value: string;
  increment: string;
  max_value: string;
  last_value: string | null;
  cycle: boolean;
}

export interface DbRlsTable {
  oid: number;
  schema: string;
  name: string;
  rls_enabled: boolean;
  rls_forced: boolean;
  policy_count: number;
  commands: PolicyCommand[];
}

export type PolicyCommand = "ALL" | "SELECT" | "INSERT" | "UPDATE" | "DELETE";

export interface PolicyInput {
  name: string;
  command: PolicyCommand;
  permissive: boolean;
  roles: string[];
  using_expression: string;
  check_expression: string;
}

export interface DbPolicy {
  name: string;
  permissive: boolean;
  command: PolicyCommand;
  roles: string[];
  using_expression: string | null;
  check_expression: string | null;
}

export type DatabaseAction =
  | { action: "create_schema"; name: string }
  | { action: "drop_schema"; name: string; cascade: boolean }
  | { action: "refresh_view"; schema: string; name: string }
  | { action: "drop_view"; schema: string; name: string; materialized: boolean; cascade: boolean }
  | { action: "drop_function"; oid: number; cascade: boolean }
  | { action: "set_trigger"; schema: string; table: string; name: string; enabled: boolean }
  | { action: "drop_trigger"; schema: string; table: string; name: string }
  | {
      action: "create_index";
      schema: string;
      table: string;
      name: string;
      columns: string[];
      method: string;
      unique: boolean;
      concurrently: boolean;
    }
  | { action: "drop_index"; schema: string; name: string; concurrently: boolean }
  | { action: "create_enum"; schema: string; name: string; values: string[] }
  | { action: "add_enum_value"; schema: string; name: string; value: string }
  | { action: "rename_enum_value"; schema: string; name: string; from: string; to: string }
  | { action: "drop_enum"; schema: string; name: string; cascade: boolean }
  | { action: "enable_extension"; name: string; schema: string }
  | { action: "disable_extension"; name: string; cascade: boolean }
  | { action: "create_role"; name: string; attributes: DbRoleAttributes; password: string }
  | { action: "alter_role"; name: string; attributes: DbRoleAttributes }
  | { action: "set_role_password"; name: string; password: string }
  | { action: "drop_role"; name: string }
  | {
      action: "set_publication_table";
      publication: string;
      schema: string;
      table: string;
      add: boolean;
    }
  | {
      action: "set_publication_actions";
      publication: string;
      insert: boolean;
      update: boolean;
      delete: boolean;
      truncate: boolean;
    }
  | { action: "reset_sequence"; schema: string; name: string; value: number }
  | {
      action: "set_rls";
      schema: string;
      table: string;
      mode: "enable" | "disable" | "force" | "no_force";
    }
  | { action: "create_policy"; schema: string; table: string; policy: PolicyInput }
  | {
      action: "update_policy";
      schema: string;
      table: string;
      original: string;
      policy: PolicyInput;
    }
  | { action: "drop_policy"; schema: string; table: string; name: string };

export interface DatabaseListQuery {
  schema?: string;
  parent?: string;
  search?: string;
  offset?: number;
}

export const supabaseStudioDatabaseList = <T>(
  reference: string,
  kind: DatabaseListKind,
  { schema = "", parent = "", search = "", offset = 0 }: DatabaseListQuery,
) =>
  invoke<DatabaseListPage<T>>("supabase_studio_database_list", {
    reference,
    kind,
    schema,
    parent,
    search,
    offset,
  });

export const supabaseStudioDatabaseDefinition = (
  reference: string,
  kind: "view" | "function",
  oid: number,
) => invoke<string>("supabase_studio_database_definition", { reference, kind, oid });

export const supabaseStudioDatabaseAction = (reference: string, action: DatabaseAction) =>
  invoke<void>("supabase_studio_database_action", { reference, action });
