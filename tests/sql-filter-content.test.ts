import { expect, test } from "bun:test";
import { buildFkSearchFilter } from "../src/lib/fk-lookup";
import { compileContentFilter, compileSingleCondition } from "../src/lib/sql-filter";

test("compileContentFilter joins column matches with OR", () => {
  expect(compileContentFilter(["id", 'na"me'], "o'x")).toBe(
    `"id"::text ILIKE '%o''x%' ESCAPE '!' OR "na""me"::text ILIKE '%o''x%' ESCAPE '!'`,
  );
  expect(compileContentFilter([], "x")).toBe("");
  expect(compileContentFilter(["id"], "")).toBe("");
});

test("compileSingleCondition uses dialect-specific text matching", () => {
  expect(compileSingleCondition("name", "contains", "o'x", "oracle")).toBe(
    `UPPER(TO_CHAR("name")) LIKE UPPER('%o''x%') ESCAPE '!'`,
  );
  expect(compileSingleCondition("name", "startsWith", "50%", "mysql")).toBe(
    "CAST(`name` AS CHAR) LIKE '50!%%' ESCAPE '!'",
  );
  expect(compileSingleCondition("name", "endsWith", "x", "mssql")).toBe(
    `CAST([name] AS NVARCHAR(MAX)) LIKE N'%x' ESCAPE '!'`,
  );
  expect(compileSingleCondition("name", "contains", "x", "sqlite")).toBe(
    `CAST("name" AS TEXT) LIKE '%x%' ESCAPE '!'`,
  );
  expect(compileSingleCondition("name", "contains", "x", "clickhouse")).toBe(
    `toString("name") ILIKE '%x%'`,
  );
  expect(compileSingleCondition("name", "contains", "x", "postgres")).toBe(
    `"name"::text ILIKE '%x%' ESCAPE '!'`,
  );
});

test("compileSingleCondition quotes numbers and booleans on strict dialects", () => {
  expect(compileSingleCondition("id", "eq", "42", "oracle")).toBe(`"id" = '42'`);
  expect(compileSingleCondition("id", "eq", "true", "mssql")).toBe(`[id] = N'true'`);
  expect(compileSingleCondition("id", "eq", "42", "postgres")).toBe(`"id" = 42`);
  expect(compileSingleCondition("id", "eq", "true")).toBe(`"id" = true`);
});

test("buildFkSearchFilter follows the dialect", () => {
  expect(buildFkSearchFilter("id", ["name"], "ada", "oracle")).toBe(
    `(UPPER(TO_CHAR("id")) LIKE UPPER('%ada%') ESCAPE '!' OR UPPER(TO_CHAR("name")) LIKE UPPER('%ada%') ESCAPE '!')`,
  );
});
