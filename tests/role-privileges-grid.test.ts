import { describe, expect, test } from "bun:test";
import { allPrivsGranted, applicablePrivs } from "../src/features/users/users-view/priv-key";
import type { TablePrivileges } from "../src/lib/db";

function privileges(overrides: Partial<TablePrivileges>): TablePrivileges {
  return {
    schema: "public",
    table: "t",
    object_type: "table",
    select: false,
    insert: false,
    update: false,
    delete: false,
    truncate: false,
    references: false,
    trigger: false,
    ...overrides,
  };
}

describe("role privilege grid", () => {
  test("sequences only offer the privileges Postgres supports on them", () => {
    expect([...applicablePrivs("sequence")]).toEqual(["SELECT", "UPDATE"]);
    expect(applicablePrivs("table")).toHaveLength(7);
    expect(applicablePrivs("view")).toHaveLength(7);
    expect(applicablePrivs("materialized_view")).toHaveLength(7);
  });

  test("ALL is checked for a sequence with every sequence privilege", () => {
    expect(
      allPrivsGranted(privileges({ object_type: "sequence", select: true, update: true })),
    ).toBe(true);
    expect(allPrivsGranted(privileges({ object_type: "sequence", select: true }))).toBe(false);
  });

  test("ALL for tables still needs all seven privileges", () => {
    const all = {
      select: true,
      insert: true,
      update: true,
      delete: true,
      truncate: true,
      references: true,
    };
    expect(allPrivsGranted(privileges({ ...all, trigger: true }))).toBe(true);
    expect(allPrivsGranted(privileges(all))).toBe(false);
  });
});
