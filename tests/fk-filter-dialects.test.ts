import { describe, expect, test } from "bun:test";
import { formatFkFilter } from "../src/features/table/data-table/fk-links";

describe("formatFkFilter", () => {
  test("quotes identifiers per dialect", () => {
    expect(formatFkFilter("customer_id", 5, "postgres")).toBe('"customer_id" = 5');
    expect(formatFkFilter("customer_id", 5, "mysql")).toBe("`customer_id` = 5");
    expect(formatFkFilter("customer_id", 5, "mssql")).toBe("[customer_id] = 5");
    expect(formatFkFilter("customer_id", 5, "oracle")).toBe('"customer_id" = 5');
    expect(formatFkFilter("customer_id", 5, "sqlite")).toBe('"customer_id" = 5');
    expect(formatFkFilter("customer_id", 5, "duckdb")).toBe('"customer_id" = 5');
    expect(formatFkFilter("customer_id", 5, "bigquery")).toBe("`customer_id` = 5");
  });

  test("escapes quote characters inside identifiers", () => {
    expect(formatFkFilter('we"ird', 1, "postgres")).toBe('"we""ird" = 1');
    expect(formatFkFilter("we`ird", 1, "mysql")).toBe("`we``ird` = 1");
    expect(formatFkFilter("we]ird", 1, "mssql")).toBe("[we]]ird] = 1");
  });

  test("escapes string values per dialect", () => {
    expect(formatFkFilter("code", "O'Brien", "postgres")).toBe(`"code" = 'O''Brien'`);
    expect(formatFkFilter("code", "a\\b", "postgres")).toBe(`"code" = E'a\\\\b'`);
    expect(formatFkFilter("code", "a\\b", "mysql")).toBe(
      "`code` = CONCAT('a', CHAR(92 USING utf8mb4), 'b')",
    );
    expect(formatFkFilter("code", "a\\'b", "mysql")).toBe(
      "`code` = CONCAT('a', CHAR(92 USING utf8mb4), '''b')",
    );
    expect(formatFkFilter("code", "x'y", "mssql")).toBe("[code] = N'x''y'");
    expect(formatFkFilter("code", "a\\b", "sqlite")).toBe(`"code" = 'a\\b'`);
    expect(formatFkFilter("code", "a\\b", "oracle")).toBe(`"code" = 'a\\b'`);
  });

  test("keeps numeric-looking strings quoted so text keys still match", () => {
    expect(formatFkFilter("code", "007", "mysql")).toBe("`code` = '007'");
    expect(formatFkFilter("code", "007", "postgres")).toBe(`"code" = '007'`);
  });

  test("handles bigint, boolean and empty values", () => {
    expect(formatFkFilter("id", 12345678901234567890n, "postgres")).toBe(
      '"id" = 12345678901234567890',
    );
    expect(formatFkFilter("flag", true, "postgres")).toBe('"flag" = true');
    expect(formatFkFilter("flag", true, "mssql")).toBe("[flag] = N'true'");
    expect(formatFkFilter("id", null, "mysql")).toBe("");
    expect(formatFkFilter("id", undefined, "mysql")).toBe("");
  });
});
