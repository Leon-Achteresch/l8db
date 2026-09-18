import { invoke } from "./core";
import type { DatabaseKind } from "./providers";
import type {
  AlterRoleOptions,
  CreateRoleOptions,
  ERSchema,
  ForeignKeyInfo,
  PrivilegeChange,
  RoleInfo,
  RolePrivileges,
  TriggerInfo,
} from "./types";

export async function listRoles(
  kind: DatabaseKind,
  connectionString: string,
  database?: string,
): Promise<RoleInfo[]> {
  return invoke("list_roles", { kind, connectionString, database });
}

export async function createRole(
  kind: DatabaseKind,
  connectionString: string,
  options: CreateRoleOptions,
  database?: string,
): Promise<void> {
  await invoke("create_role", { kind, connectionString, database, options });
}

export async function alterRole(
  kind: DatabaseKind,
  connectionString: string,
  options: AlterRoleOptions,
  database?: string,
): Promise<void> {
  await invoke("alter_role", { kind, connectionString, database, options });
}

export async function dropRole(
  kind: DatabaseKind,
  connectionString: string,
  name: string,
  database?: string,
): Promise<void> {
  await invoke("drop_role", { kind, connectionString, database, name });
}

export async function listRolePrivileges(
  kind: DatabaseKind,
  connectionString: string,
  roleName: string,
  database?: string,
): Promise<RolePrivileges> {
  return invoke("list_role_privileges", {
    kind,
    connectionString,
    database,
    roleName,
  });
}

export async function modifyPrivilege(
  kind: DatabaseKind,
  connectionString: string,
  change: PrivilegeChange,
  database?: string,
): Promise<void> {
  await invoke("modify_privilege", {
    kind,
    connectionString,
    database,
    change,
  });
}

export async function listForeignKeys(
  kind: DatabaseKind,
  connectionString: string,
  schema: string,
  table: string,
  database?: string,
): Promise<ForeignKeyInfo[]> {
  return invoke("list_foreign_keys", {
    kind,
    connectionString,
    database,
    schema,
    table,
  });
}

export async function getErSchema(
  kind: DatabaseKind,
  connectionString: string,
  database?: string,
  schema?: string,
): Promise<ERSchema> {
  return invoke("get_er_schema", {
    kind,
    connectionString,
    database,
    schema,
  });
}

export async function listTriggers(
  kind: DatabaseKind,
  connectionString: string,
  schema: string,
  table: string,
  database?: string,
): Promise<TriggerInfo[]> {
  return invoke("list_triggers", {
    kind,
    connectionString,
    database,
    schema,
    table,
  });
}

export async function dropTable(
  kind: DatabaseKind,
  connectionString: string,
  schema: string,
  table: string,
  database?: string,
): Promise<void> {
  await invoke("drop_table", {
    kind,
    connectionString,
    database,
    schema,
    table,
  });
}

export async function truncateTable(
  kind: DatabaseKind,
  connectionString: string,
  schema: string,
  table: string,
  database?: string,
): Promise<void> {
  await invoke("truncate_table", {
    kind,
    connectionString,
    database,
    schema,
    table,
  });
}
