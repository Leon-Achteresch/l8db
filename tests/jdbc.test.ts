import { expect, mock, test } from "bun:test";

mock.module("@tauri-apps/api/core", () => ({
  transformCallback: () => 1,
  invoke: async () => null,
}));

const { jdbcConnectionString } = await import("@/lib/db/jdbc");

test("JDBC pointers contain only profile IDs and reject malformed IDs", () => {
  expect(jdbcConnectionString("profile-123_abc")).toBe("jdbc:l8db:profile-123_abc");
  for (const id of [
    "",
    "../outside",
    "jdbc:postgresql://host/db",
    "name:password",
    "profile?secret=x",
    "x".repeat(81),
  ]) {
    expect(() => jdbcConnectionString(id)).toThrow();
  }
});
