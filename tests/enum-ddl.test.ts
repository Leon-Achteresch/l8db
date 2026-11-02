import { expect, test } from "bun:test";
import {
  addEnumValueSql,
  createEnumSql,
  dropEnumSql,
  enumLabels,
  renameEnumValueSql,
} from "../src/lib/enum-ddl";

test("enum values are entered one per line and may contain commas and quotes", () => {
  const labels = enumLabels(" a, b \n\nit's\r\nc ");
  expect(labels).toEqual(["a, b", "it's", "c"]);
  expect(createEnumSql("app", "Mood", labels)).toBe(
    `CREATE TYPE "app"."Mood" AS ENUM ('a, b', 'it''s', 'c')`,
  );
});

test("enum values can be added and renamed", () => {
  expect(addEnumValueSql("public", "mood", "neu")).toBe(
    `ALTER TYPE "public"."mood" ADD VALUE 'neu'`,
  );
  expect(renameEnumValueSql("public", "mood", "alt", "neu")).toBe(
    `ALTER TYPE "public"."mood" RENAME VALUE 'alt' TO 'neu'`,
  );
  expect(dropEnumSql("public", "mood")).toBe(`DROP TYPE "public"."mood"`);
});
