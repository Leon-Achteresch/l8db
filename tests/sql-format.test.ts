import { expect, test } from "bun:test";

import {
  DEFAULT_SQL_DIALECT,
  formatSqlWith,
  sqlDialectForKind,
  sqlDialectLabel,
  supportsSqlFormatting,
} from "../src/lib/sql-format";

test("sqlDialectForKind maps supported SQL families", () => {
  expect(sqlDialectForKind("postgres")).toBe("postgresql");
  expect(sqlDialectForKind("mysql")).toBe("mysql");
  expect(sqlDialectForKind("sqlite")).toBe("sqlite");
  expect(sqlDialectForKind("mssql")).toBe("transactsql");
  expect(sqlDialectForKind("clickhouse")).toBe("clickhouse");
  expect(sqlDialectForKind("oracle")).toBe("plsql");
  expect(sqlDialectForKind("duckdb")).toBe("duckdb");
});

test("sqlDialectForKind falls back to standard sql for unmapped or missing kinds", () => {
  expect(sqlDialectForKind("odbc")).toBe(DEFAULT_SQL_DIALECT);
  expect(sqlDialectForKind("mongodb")).toBe(DEFAULT_SQL_DIALECT);
  expect(sqlDialectForKind(null)).toBe("sql");
  expect(sqlDialectForKind(undefined)).toBe("sql");
  expect(sqlDialectLabel(sqlDialectForKind(null))).toBe("Standard-SQL");
});

test("supportsSqlFormatting only accepts sql query languages", () => {
  expect(supportsSqlFormatting("sql")).toBe(true);
  expect(supportsSqlFormatting("cql")).toBe(false);
  expect(supportsSqlFormatting("json")).toBe(false);
  expect(supportsSqlFormatting("redis")).toBe(false);
  expect(supportsSqlFormatting(null)).toBe(false);
});

test("formatSqlWith applies indentation and keyword case", () => {
  const upper = formatSqlWith("select id from users where id = 1", {
    dialect: "postgresql",
    tabWidth: 4,
    keywordCase: "upper",
  });
  expect(upper.ok).toBe(true);
  expect(upper.sql).toContain("SELECT");
  expect(upper.sql).toContain("    id");

  const lower = formatSqlWith("SELECT id FROM users", {
    dialect: "sql",
    tabWidth: 2,
    keywordCase: "lower",
  });
  expect(lower.ok).toBe(true);
  expect(lower.sql).toContain("select");
  expect(lower.sql).toContain("  id");
});

test("formatSqlWith keeps text unchanged and reports the reason on failure", () => {
  const result = formatSqlWith("select 1", {
    dialect: "not-a-dialect" as never,
    tabWidth: 2,
    keywordCase: "upper",
  });
  expect(result.ok).toBe(false);
  expect(result.sql).toBe("select 1");
  if (!result.ok) expect(result.reason.length).toBeGreaterThan(0);
});
