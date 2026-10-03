import { describe, expect, test } from "bun:test";
import {
  alterRoleOptions,
  roleEditState,
  validUntilInputValue,
} from "../src/features/users/users-view/alter-role-options";
import type { RoleInfo } from "../src/lib/db";

function role(overrides: Partial<RoleInfo> = {}): RoleInfo {
  return {
    name: "app",
    oid: "1",
    superuser: false,
    can_login: true,
    create_db: false,
    create_role: false,
    replication: false,
    bypass_rls: false,
    conn_limit: -1,
    valid_until: null,
    member_of: [],
    members: [],
    ...overrides,
  };
}

describe("validUntilInputValue", () => {
  test("converts Postgres timestamptz text into a datetime-local value", () => {
    expect(validUntilInputValue("2026-12-31 00:00:00+01")).toBe("2026-12-31T00:00");
    expect(validUntilInputValue("2026-12-31 23:59:30.5-05:30")).toBe("2026-12-31T23:59:30");
    expect(validUntilInputValue("2026-12-31 08:15:00+05:45:12")).toBe("2026-12-31T08:15");
    expect(validUntilInputValue("2026-12-31T08:15")).toBe("2026-12-31T08:15");
  });

  test("treats missing, infinite and unparseable values as no visible date", () => {
    expect(validUntilInputValue(null)).toBe("");
    expect(validUntilInputValue("infinity")).toBe("");
    expect(validUntilInputValue("-infinity")).toBe("");
    expect(validUntilInputValue("Thu Dec 31 00:00:00 2026 CET")).toBe("");
  });
});

describe("alterRoleOptions", () => {
  test("the edit form shows the existing expiry", () => {
    expect(roleEditState(role({ valid_until: "2026-12-31 00:00:00+01" })).valid_until).toBe(
      "2026-12-31T00:00",
    );
  });

  test("saving an unrelated change keeps the existing expiry and limit", () => {
    const current = role({ valid_until: "2026-12-31 00:00:00+01", conn_limit: 5 });
    const options = alterRoleOptions(current, { ...roleEditState(current), create_db: true });
    expect(options.create_db).toBe(true);
    expect(options.clear_valid_until).toBe(false);
    expect(options.valid_until).toBeUndefined();
    expect(options.conn_limit).toBeUndefined();
  });

  test("an unparseable expiry is never cleared implicitly", () => {
    const current = role({ valid_until: "Thu Dec 31 00:00:00 2026 CET" });
    const options = alterRoleOptions(current, { ...roleEditState(current), create_db: true });
    expect(options.clear_valid_until).toBe(false);
    expect(options.valid_until).toBeUndefined();
  });

  test("clearing the expiry field removes the expiry", () => {
    const current = role({ valid_until: "2026-12-31 00:00:00+01" });
    const options = alterRoleOptions(current, { ...roleEditState(current), valid_until: "" });
    expect(options.clear_valid_until).toBe(true);
    expect(options.valid_until).toBeUndefined();
  });

  test("changing the expiry sends the new value", () => {
    const current = role({ valid_until: "2026-12-31 00:00:00+01" });
    const options = alterRoleOptions(current, {
      ...roleEditState(current),
      valid_until: "2027-01-15T12:00",
    });
    expect(options.valid_until).toBe("2027-01-15T12:00");
    expect(options.clear_valid_until).toBe(false);
  });

  test("clearing the connection limit resets it to unlimited", () => {
    const current = role({ conn_limit: 10 });
    const options = alterRoleOptions(current, { ...roleEditState(current), conn_limit: "" });
    expect(options.conn_limit).toBe(-1);
  });

  test("an unchanged unlimited role does not send a connection limit", () => {
    const current = role();
    expect(alterRoleOptions(current, roleEditState(current)).conn_limit).toBeUndefined();
  });

  test("a new connection limit is sent", () => {
    const current = role();
    const options = alterRoleOptions(current, { ...roleEditState(current), conn_limit: "25" });
    expect(options.conn_limit).toBe(25);
  });

  test("invalid connection limits are rejected", () => {
    const current = role();
    for (const value of ["1.5", "-2", "abc", "99999999999"])
      expect(() =>
        alterRoleOptions(current, { ...roleEditState(current), conn_limit: value }),
      ).toThrow("Ungültiges Verbindungslimit");
  });
});
