import { expect, test } from "bun:test";
import {
  changeCount,
  changeOf,
  cloneChange,
  draftOf,
  emptyDetail,
  principalName,
} from "../src/features/users/principal-view/principal-draft";
import type { ObjectGrant, PrincipalDetail } from "../src/lib/db";

function grant(privilege: string, extra: Partial<ObjectGrant> = {}): ObjectGrant {
  return {
    owner: "HR",
    object: "EMP",
    object_type: "TABLE",
    privilege,
    column: null,
    grantable: false,
    grantor: "HR",
    ...extra,
  };
}

function user(extra: Partial<PrincipalDetail> = {}): PrincipalDetail {
  return {
    ...emptyDetail("user", "APP"),
    default_tablespace: "USERS",
    temporary_tablespace: "TEMP",
    profile: "DEFAULT",
    roles: [
      { name: "CONNECT", admin: false, default: true },
      { name: "APP_WRITE", admin: true, default: true },
    ],
    system_privileges: [{ name: "CREATE SESSION", admin: false }],
    quotas: [{ tablespace: "USERS", bytes: 10, max_bytes: 1024 }],
    ...extra,
  };
}

test("an untouched draft changes nothing", () => {
  const detail = user({ object_privileges: [grant("SELECT"), grant("UPDATE", { column: "A" })] });
  const change = changeOf(detail, draftOf(detail));
  expect(change).toEqual({ kind: "user", name: "APP", action: "alter" });
  expect(changeCount(change)).toBe(0);
});

test("grants, revokes and admin option changes become the smallest statement set", () => {
  const detail = user();
  const draft = draftOf(detail);
  draft.roles = {
    APP_WRITE: { admin: false, default: true },
    DBA: { admin: true, default: true },
  };
  draft.systemPrivileges = { "CREATE SESSION": { admin: true, default: true } };
  const change = changeOf(detail, draft);
  expect(change.grant_roles).toEqual([
    { name: "APP_WRITE", admin: false },
    { name: "DBA", admin: true },
  ]);
  expect(change.revoke_roles).toEqual(["APP_WRITE", "CONNECT"]);
  expect(change.grant_system_privileges).toEqual([{ name: "CREATE SESSION", admin: true }]);
  expect(change.revoke_system_privileges).toBeUndefined();
  expect(change.default_roles).toBeUndefined();
  expect(change.default_roles_all).toBe(true);
  expect(changeCount(change)).toBe(6);
});

test("a new or re-granted role always states its default flag", () => {
  const detail = user();
  const draft = draftOf(detail);
  draft.roles = { ...draft.roles, DBA: { admin: false, default: false } };
  const change = changeOf(detail, draft);
  expect(change.default_roles).toEqual(["APP_WRITE", "CONNECT"]);
  expect(changeCount(change)).toBe(2);

  const upgraded = draftOf(detail);
  upgraded.roles = { ...upgraded.roles, CONNECT: { admin: true, default: true } };
  expect(changeOf(detail, upgraded).default_roles_all).toBeUndefined();

  const source = user({ roles: [{ name: "DBA", admin: false, default: false }] });
  expect(cloneChange(source, "COPY", "pw").default_roles).toEqual([]);
});

test("default roles are only sent when the visible state differs from the server", () => {
  const detail = user();
  const draft = draftOf(detail);
  draft.roles = { ...draft.roles, CONNECT: { admin: false, default: false } };
  expect(changeOf(detail, draft).default_roles).toEqual(["APP_WRITE"]);

  const explicit = user({
    roles: [
      { name: "CONNECT", admin: false, default: true },
      { name: "APP_WRITE", admin: false, default: false },
    ],
  });
  const added = draftOf(explicit);
  added.roles = { ...added.roles, DBA: { admin: false, default: true } };
  expect(changeOf(explicit, added).default_roles).toEqual(["CONNECT", "DBA"]);

  const all = draftOf(explicit);
  all.roles = { ...all.roles, APP_WRITE: { admin: false, default: true } };
  const change = changeOf(explicit, all);
  expect(change.default_roles_all).toBe(true);
  expect(change.grant_roles).toBeUndefined();

  const none = draftOf(explicit);
  none.roles = { ...none.roles, CONNECT: { admin: false, default: false } };
  expect(changeOf(explicit, none).default_roles).toEqual([]);
});

test("a table wide revoke grants the surviving column and table privileges again", () => {
  const detail = user({
    object_privileges: [
      grant("UPDATE"),
      grant("UPDATE", { column: "A" }),
      grant("UPDATE", { column: "B" }),
      grant("SELECT", { grantable: true }),
      grant("DELETE"),
    ],
  });
  const withoutColumn = draftOf(detail);
  withoutColumn.objectPrivileges = detail.object_privileges.filter((item) => item.column !== "A");
  const columnChange = changeOf(detail, withoutColumn);
  expect(columnChange.revoke_object_privileges).toEqual([grant("UPDATE", { column: "A" })]);
  expect(columnChange.grant_object_privileges).toEqual([
    grant("UPDATE"),
    grant("UPDATE", { column: "B" }),
  ]);

  const withoutTable = draftOf(detail);
  withoutTable.objectPrivileges = detail.object_privileges.filter(
    (item) => !(item.privilege === "UPDATE" && item.column === null),
  );
  expect(changeOf(detail, withoutTable).grant_object_privileges).toEqual([
    grant("UPDATE", { column: "A" }),
    grant("UPDATE", { column: "B" }),
  ]);

  const noGrantOption = draftOf(detail);
  noGrantOption.objectPrivileges = detail.object_privileges.map((item) =>
    item.privilege === "SELECT" ? { ...item, grantable: false } : item,
  );
  const optionChange = changeOf(detail, noGrantOption);
  expect(optionChange.revoke_object_privileges).toEqual([grant("SELECT", { grantable: true })]);
  expect(optionChange.grant_object_privileges).toEqual([grant("SELECT")]);

  const withGrantOption = draftOf(detail);
  withGrantOption.objectPrivileges = detail.object_privileges.map((item) =>
    item.privilege === "DELETE" ? { ...item, grantable: true } : item,
  );
  const added = changeOf(detail, withGrantOption);
  expect(added.revoke_object_privileges).toBeUndefined();
  expect(added.grant_object_privileges).toEqual([grant("DELETE", { grantable: true })]);
});

test("properties, quotas, members and limits only list what changed", () => {
  const detail = user();
  const draft = draftOf(detail);
  draft.profile = "APP_PROFILE";
  draft.quotas = { USERS: -1, DATA: 0, INDEXES: 2048 };
  expect(changeOf(detail, draft)).toEqual({
    kind: "user",
    name: "APP",
    action: "alter",
    profile: "APP_PROFILE",
    quotas: [
      { tablespace: "USERS", max_bytes: -1 },
      { tablespace: "INDEXES", max_bytes: 2048 },
    ],
  });
  const removed = draftOf(detail);
  removed.quotas = {};
  expect(changeOf(detail, removed).quotas).toEqual([{ tablespace: "USERS", max_bytes: 0 }]);

  const role: PrincipalDetail = {
    ...emptyDetail("role", "APP_READ"),
    members: [
      { name: "SCOTT", admin: true },
      { name: "HR", admin: false },
    ],
  };
  const members = draftOf(role);
  members.members = {
    SCOTT: { admin: false, default: true },
    WEB: { admin: false, default: true },
  };
  const roleChange = changeOf(role, members);
  expect(roleChange.revoke_members).toEqual(["SCOTT", "HR"]);
  expect(roleChange.grant_members).toEqual([
    { name: "SCOTT", admin: false },
    { name: "WEB", admin: false },
  ]);
  expect(roleChange.default_roles).toBeUndefined();

  const profile: PrincipalDetail = {
    ...emptyDetail("profile", "APP_PROFILE"),
    limits: [
      { resource: "IDLE_TIME", kind: "KERNEL", value: "30" },
      { resource: "FAILED_LOGIN_ATTEMPTS", kind: "PASSWORD", value: "5" },
    ],
  };
  const limits = draftOf(profile);
  limits.limits = { IDLE_TIME: " 60 ", FAILED_LOGIN_ATTEMPTS: "5" };
  expect(changeOf(profile, limits).limits).toEqual([{ resource: "IDLE_TIME", value: "60" }]);
  limits.limits = { IDLE_TIME: " ", FAILED_LOGIN_ATTEMPTS: "5" };
  expect(changeCount(changeOf(profile, limits))).toBe(0);
});

test("cloning recreates every grant under the new name", () => {
  const source = user({
    roles: [
      { name: "CONNECT", admin: false, default: true },
      { name: "DBA", admin: false, default: false },
    ],
    object_privileges: [grant("SELECT", { grantable: true })],
    quotas: [{ tablespace: "USERS", bytes: 99, max_bytes: -1 }],
  });
  expect(cloneChange(source, "COPY", "pw")).toEqual({
    kind: "user",
    name: "COPY",
    action: "create",
    password: "pw",
    default_tablespace: "USERS",
    temporary_tablespace: "TEMP",
    profile: "DEFAULT",
    quotas: [{ tablespace: "USERS", max_bytes: -1 }],
    default_roles: ["CONNECT"],
    grant_roles: [
      { name: "CONNECT", admin: false },
      { name: "DBA", admin: false },
    ],
    grant_system_privileges: [{ name: "CREATE SESSION", admin: false }],
    grant_object_privileges: [grant("SELECT", { grantable: true })],
  });
  expect(cloneChange(emptyDetail("role", "R"), "R2", "ignored")).toEqual({
    kind: "role",
    name: "R2",
    action: "create",
  });
  const profile: PrincipalDetail = {
    ...emptyDetail("profile", "P"),
    limits: [
      { resource: "IDLE_TIME", kind: "KERNEL", value: "30" },
      { resource: "PASSWORD_VERIFY_FUNCTION", kind: "PASSWORD", value: "FROM ROOT" },
    ],
  };
  expect(cloneChange(profile, "P2", "").limits).toEqual([{ resource: "IDLE_TIME", value: "30" }]);
});

test("new names follow Oracle folding and keep quoted spellings", () => {
  expect(principalName(" scott ")).toBe("SCOTT");
  expect(principalName("app_owner$1")).toBe("APP_OWNER$1");
  expect(principalName("Mixed Case")).toBe("Mixed Case");
  expect(principalName("1st")).toBe("1st");
  expect(principalName("  ")).toBe("");
});
