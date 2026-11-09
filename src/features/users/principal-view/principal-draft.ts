import type { ObjectGrant, PrincipalChange, PrincipalDetail, PrincipalKind } from "@/lib/db";

export interface GrantFlags {
  admin: boolean;
  default: boolean;
}

export interface PrincipalDraft {
  defaultTablespace: string;
  temporaryTablespace: string;
  profile: string;
  roles: Record<string, GrantFlags>;
  systemPrivileges: Record<string, GrantFlags>;
  members: Record<string, GrantFlags>;
  objectPrivileges: ObjectGrant[];
  quotas: Record<string, number>;
  limits: Record<string, string>;
}

function flags<T extends { name: string; admin: boolean; default?: boolean }>(items: T[]) {
  return Object.fromEntries(
    items.map((item) => [item.name, { admin: item.admin, default: item.default ?? true }]),
  );
}

export function draftOf(detail: PrincipalDetail): PrincipalDraft {
  return {
    defaultTablespace: detail.default_tablespace ?? "",
    temporaryTablespace: detail.temporary_tablespace ?? "",
    profile: detail.profile ?? "",
    roles: flags(detail.roles),
    systemPrivileges: flags(detail.system_privileges),
    members: detail.kind === "role" ? flags(detail.members) : {},
    objectPrivileges: detail.object_privileges,
    quotas: Object.fromEntries(detail.quotas.map((quota) => [quota.tablespace, quota.max_bytes])),
    limits: Object.fromEntries(detail.limits.map((limit) => [limit.resource, limit.value])),
  };
}

export function emptyDetail(kind: PrincipalKind, name: string): PrincipalDetail {
  return {
    name,
    kind,
    system: false,
    limited: false,
    status: null,
    locked: false,
    expired: false,
    lock_date: null,
    expiry_date: null,
    created: null,
    last_login: null,
    default_tablespace: null,
    temporary_tablespace: null,
    profile: null,
    authentication: null,
    roles: [],
    system_privileges: [],
    object_privileges: [],
    object_privileges_truncated: false,
    quotas: [],
    members: [],
    limits: [],
    script: "",
  };
}

export function objectGrantKey(grant: ObjectGrant): string {
  return [grant.owner, grant.object, grant.privilege, grant.column ?? ""].join("\u0000");
}

function grantDiff(
  original: { name: string; admin: boolean }[],
  desired: Record<string, GrantFlags>,
) {
  const grant: { name: string; admin: boolean }[] = [];
  const revoke: string[] = [];
  const before = new Map(original.map((item) => [item.name, item.admin]));
  for (const [name, { admin }] of Object.entries(desired)) {
    const had = before.get(name);
    if (had === admin) continue;
    if (had === true) revoke.push(name);
    grant.push({ name, admin });
  }
  for (const name of before.keys()) if (!(name in desired)) revoke.push(name);
  return { grant, revoke };
}

function objectDiff(original: ObjectGrant[], desired: ObjectGrant[]) {
  if (original === desired) return { grant: [], revoke: [] };
  const before = new Map(original.map((grant) => [objectGrantKey(grant), grant]));
  const after = new Map(desired.map((grant) => [objectGrantKey(grant), grant]));
  const grant = new Map<string, ObjectGrant>();
  const revoke: ObjectGrant[] = [];
  for (const [key, item] of after) {
    const had = before.get(key);
    if (had?.grantable === item.grantable) continue;
    if (had?.grantable) revoke.push(had);
    grant.set(key, item);
  }
  for (const [key, item] of before) if (!after.has(key)) revoke.push(item);
  const scope = (item: ObjectGrant) => [item.owner, item.object, item.privilege].join("\u0000");
  const revoked = new Set(revoke.map(scope));
  if (revoked.size > 0) {
    for (const [key, item] of after) if (revoked.has(scope(item))) grant.set(key, item);
  }
  return { grant: [...grant.values()], revoke };
}

function defaultRoles(detail: PrincipalDetail, draft: PrincipalDraft, granted: string[]) {
  const desired = Object.entries(draft.roles);
  const wanted = desired
    .filter(([, role]) => role.default)
    .map(([name]) => name)
    .sort();
  const had = detail.roles
    .filter((role) => role.default && role.name in draft.roles)
    .map((role) => role.name)
    .sort();
  const admin = new Map(detail.roles.map((role) => [role.name, role.admin]));
  const fresh = granted.some((name) => admin.get(name) !== false);
  if (!fresh && had.join("\u0000") === wanted.join("\u0000")) return {};
  return wanted.length === desired.length ? { default_roles_all: true } : { default_roles: wanted };
}

export function changeOf(detail: PrincipalDetail, draft: PrincipalDraft): PrincipalChange {
  const change: PrincipalChange = { kind: detail.kind, name: detail.name, action: "alter" };
  if (detail.kind === "profile") {
    const before = new Map(detail.limits.map((limit) => [limit.resource, limit.value]));
    const limits = Object.entries(draft.limits)
      .filter(([resource, value]) => value.trim() !== "" && before.get(resource) !== value.trim())
      .map(([resource, value]) => ({ resource, value: value.trim() }));
    return limits.length > 0 ? { ...change, limits } : change;
  }
  const roles = grantDiff(detail.roles, draft.roles);
  if (detail.kind === "user") {
    if (draft.defaultTablespace !== (detail.default_tablespace ?? ""))
      change.default_tablespace = draft.defaultTablespace;
    if (draft.temporaryTablespace !== (detail.temporary_tablespace ?? ""))
      change.temporary_tablespace = draft.temporaryTablespace;
    if (draft.profile !== (detail.profile ?? "")) change.profile = draft.profile;
    const before = new Map(detail.quotas.map((quota) => [quota.tablespace, quota.max_bytes]));
    const quotas = [...new Set([...before.keys(), ...Object.keys(draft.quotas)])]
      .filter((tablespace) => (before.get(tablespace) ?? 0) !== (draft.quotas[tablespace] ?? 0))
      .map((tablespace) => ({ tablespace, max_bytes: draft.quotas[tablespace] ?? 0 }));
    if (quotas.length > 0) change.quotas = quotas;
    Object.assign(
      change,
      defaultRoles(
        detail,
        draft,
        roles.grant.map((role) => role.name),
      ),
    );
  }
  if (roles.grant.length > 0) change.grant_roles = roles.grant;
  if (roles.revoke.length > 0) change.revoke_roles = roles.revoke;
  const system = grantDiff(detail.system_privileges, draft.systemPrivileges);
  if (system.grant.length > 0) change.grant_system_privileges = system.grant;
  if (system.revoke.length > 0) change.revoke_system_privileges = system.revoke;
  const objects = objectDiff(detail.object_privileges, draft.objectPrivileges);
  if (objects.grant.length > 0) change.grant_object_privileges = objects.grant;
  if (objects.revoke.length > 0) change.revoke_object_privileges = objects.revoke;
  if (detail.kind === "role") {
    const members = grantDiff(detail.members, draft.members);
    if (members.grant.length > 0) change.grant_members = members.grant;
    if (members.revoke.length > 0) change.revoke_members = members.revoke;
  }
  return change;
}

export function changeCount(change: PrincipalChange): number {
  const lists = [
    change.grant_roles,
    change.revoke_roles,
    change.grant_system_privileges,
    change.revoke_system_privileges,
    change.grant_object_privileges,
    change.revoke_object_privileges,
    change.quotas,
    change.grant_members,
    change.revoke_members,
    change.limits,
  ];
  const fields = [
    change.default_tablespace,
    change.temporary_tablespace,
    change.profile,
    change.default_roles,
    change.default_roles_all,
  ];
  return (
    lists.reduce((sum, list) => sum + (list?.length ?? 0), 0) +
    fields.filter((value) => value !== undefined).length
  );
}

export function principalName(value: string): string {
  const name = value.trim();
  return /^[A-Za-z][A-Za-z0-9_$#]*$/.test(name) ? name.toUpperCase() : name;
}

export function cloneChange(
  source: PrincipalDetail,
  name: string,
  password: string,
): PrincipalChange {
  const change = changeOf(emptyDetail(source.kind, name), draftOf(source));
  return {
    ...change,
    action: "create",
    ...(change.limits
      ? { limits: change.limits.filter((limit) => /^[\w$#./]{1,128}$/.test(limit.value)) }
      : {}),
    ...(source.kind === "user" ? { password } : {}),
  };
}
