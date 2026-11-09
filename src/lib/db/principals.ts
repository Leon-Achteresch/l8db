import { invoke } from "./core";
import type { DatabaseKind } from "./providers";

export type PrincipalKind = "user" | "role" | "profile";

export interface Principal {
  name: string;
  kind: PrincipalKind;
  status: string | null;
  system: boolean;
}

export interface PrincipalList {
  items: Principal[];
  limited: boolean;
  current_user: string;
}

export interface RoleGrant {
  name: string;
  admin: boolean;
  default: boolean;
}

export interface SystemGrant {
  name: string;
  admin: boolean;
}

export interface ObjectGrant {
  owner: string;
  object: string;
  object_type: string;
  privilege: string;
  column: string | null;
  grantable: boolean;
  grantor: string;
}

export interface PrincipalQuota {
  tablespace: string;
  bytes: number;
  max_bytes: number;
}

export interface PrincipalMember {
  name: string;
  admin: boolean;
}

export interface ProfileLimit {
  resource: string;
  kind: string;
  value: string;
}

export interface PrincipalDetail {
  name: string;
  kind: PrincipalKind;
  system: boolean;
  limited: boolean;
  status: string | null;
  locked: boolean;
  expired: boolean;
  lock_date: string | null;
  expiry_date: string | null;
  created: string | null;
  last_login: string | null;
  default_tablespace: string | null;
  temporary_tablespace: string | null;
  profile: string | null;
  authentication: string | null;
  roles: RoleGrant[];
  system_privileges: SystemGrant[];
  object_privileges: ObjectGrant[];
  object_privileges_truncated: boolean;
  quotas: PrincipalQuota[];
  members: PrincipalMember[];
  limits: ProfileLimit[];
  script: string;
}

export interface PrincipalOptions {
  tablespaces: string[];
  temporary_tablespaces: string[];
  system_privileges: string[];
}

export interface GrantableObject {
  name: string;
  object_type: string;
}

export interface PrincipalChange {
  kind: PrincipalKind;
  name: string;
  action: "create" | "alter" | "drop";
  cascade?: boolean;
  password?: string;
  default_tablespace?: string;
  temporary_tablespace?: string;
  profile?: string;
  locked?: boolean;
  expire_password?: boolean;
  grant_roles?: Pick<RoleGrant, "name" | "admin">[];
  revoke_roles?: string[];
  default_roles?: string[];
  default_roles_all?: boolean;
  grant_system_privileges?: SystemGrant[];
  revoke_system_privileges?: string[];
  grant_object_privileges?: ObjectGrant[];
  revoke_object_privileges?: ObjectGrant[];
  quotas?: Pick<PrincipalQuota, "tablespace" | "max_bytes">[];
  grant_members?: PrincipalMember[];
  revoke_members?: string[];
  limits?: Pick<ProfileLimit, "resource" | "value">[];
}

export async function listPrincipals(
  kind: DatabaseKind,
  connectionString: string,
  database?: string,
): Promise<PrincipalList> {
  return invoke("list_principals", { kind, connectionString, database });
}

export async function principalDetail(
  kind: DatabaseKind,
  connectionString: string,
  principalKind: PrincipalKind,
  name: string,
  database?: string,
): Promise<PrincipalDetail> {
  return invoke("principal_detail", { kind, connectionString, database, principalKind, name });
}

export async function principalOptions(
  kind: DatabaseKind,
  connectionString: string,
  database?: string,
): Promise<PrincipalOptions> {
  return invoke("principal_options", { kind, connectionString, database });
}

export async function listGrantableObjects(
  kind: DatabaseKind,
  connectionString: string,
  owner: string,
  search: string,
  database?: string,
): Promise<GrantableObject[]> {
  return invoke("list_grantable_objects", { kind, connectionString, database, owner, search });
}

export async function previewPrincipalChange(
  kind: DatabaseKind,
  connectionString: string,
  change: PrincipalChange,
  database?: string,
): Promise<string[]> {
  return invoke("preview_principal_change", { kind, connectionString, database, change });
}

export async function applyPrincipalChange(
  kind: DatabaseKind,
  connectionString: string,
  change: PrincipalChange,
  database?: string,
): Promise<string[]> {
  return invoke("apply_principal_change", { kind, connectionString, database, change });
}
