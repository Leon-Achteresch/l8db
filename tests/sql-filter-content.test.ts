import { expect, test } from "bun:test";
import { compileContentFilter } from "../src/lib/sql-filter";

test("compileContentFilter joins column matches with OR", () => {
  expect(compileContentFilter(["id", 'na"me'], "o'x")).toBe(
    `"id"::text ILIKE '%o''x%' OR "na""me"::text ILIKE '%o''x%'`,
  );
  expect(compileContentFilter([], "x")).toBe("");
  expect(compileContentFilter(["id"], "")).toBe("");
});
