import type { EditFormState } from "@/features/users/users-view/types";
import type { AlterRoleOptions, RoleInfo } from "@/lib/db";

const PG_TIMESTAMP =
  /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}(?::?\d{2}){0,2})?$/;

export function validUntilInputValue(value: string | null): string {
  const match = value ? PG_TIMESTAMP.exec(value.trim()) : null;
  if (!match) return "";
  const [, date, time, seconds] = match;
  return seconds && seconds !== "00" ? `${date}T${time}:${seconds}` : `${date}T${time}`;
}

export function roleEditState(role: RoleInfo): EditFormState {
  return {
    superuser: role.superuser,
    can_login: role.can_login,
    create_db: role.create_db,
    create_role: role.create_role,
    replication: role.replication,
    bypass_rls: role.bypass_rls,
    conn_limit: role.conn_limit === -1 ? "" : String(role.conn_limit),
    valid_until: validUntilInputValue(role.valid_until),
    password: "",
    grant_roles: [],
    revoke_roles: [],
    current_member_of: [...role.member_of],
  };
}

function connLimit(value: string): number {
  const text = value.trim();
  if (text === "") return -1;
  if (!/^-?\d+$/.test(text) || Number(text) < -1 || Number(text) > 2147483647)
    throw new Error(`Ungültiges Verbindungslimit: ${value}`);
  return Number(text);
}

export function alterRoleOptions(role: RoleInfo, edit: EditFormState): AlterRoleOptions {
  const changed = <T>(next: T, current: T) => (next !== current ? next : undefined);
  const limit = connLimit(edit.conn_limit);
  const validUntil = edit.valid_until.trim();
  const validUntilChanged = validUntil !== validUntilInputValue(role.valid_until);
  return {
    name: role.name,
    superuser: changed(edit.superuser, role.superuser),
    can_login: changed(edit.can_login, role.can_login),
    create_db: changed(edit.create_db, role.create_db),
    create_role: changed(edit.create_role, role.create_role),
    replication: changed(edit.replication, role.replication),
    bypass_rls: changed(edit.bypass_rls, role.bypass_rls),
    conn_limit: changed(limit, role.conn_limit),
    password: edit.password || undefined,
    valid_until: validUntilChanged && validUntil ? validUntil : undefined,
    clear_valid_until: validUntilChanged && !validUntil,
    grant_roles: edit.grant_roles,
    revoke_roles: edit.revoke_roles,
  };
}
