import { expect, test } from "bun:test";
import { resolveQueryRunTarget } from "../src/lib/query-run-target";

const sql = "SELECT 'one;two';\nSELECT 42;";

test("default execution preserves selection and falls back to full script", () => {
  expect(resolveQueryRunTarget(sql, "SELECT 7", 0, "selection-or-all")).toBe("SELECT 7");
  expect(resolveQueryRunTarget(sql, "  ", 0, "selection-or-all")).toBe(sql);
});

test("statement execution respects quoted semicolons and cursor position", () => {
  expect(resolveQueryRunTarget(sql, "", 3, "selection-or-statement")).toBe("SELECT 'one;two';");
  expect(resolveQueryRunTarget(sql, "", sql.indexOf("42"), "selection-or-statement")).toBe(
    "SELECT 42;",
  );
});

test("selection takes precedence over cursor statement", () => {
  expect(resolveQueryRunTarget(sql, "SELECT 7", 0, "selection-or-statement")).toBe("SELECT 7");
});

test("explicit full script execution ignores selection", () => {
  expect(resolveQueryRunTarget(sql, "SELECT 7", 0, "all")).toBe(sql);
});

test("empty editor does not produce a statement", () => {
  expect(resolveQueryRunTarget("  ", "", 0, "selection-or-statement")).toBe("");
});

test("Oracle statement target runs the entire package from inside a procedure", () => {
  const body = "CREATE OR REPLACE PACKAGE BODY demo AS PROCEDURE p IS BEGIN NULL; END p; END demo;";
  expect(
    resolveQueryRunTarget(
      `${body}\n/`,
      "",
      body.indexOf("NULL"),
      "selection-or-statement",
      "oracle",
    ),
  ).toBe(body);
});

test("SQL-only targets skip SQL*Plus command lines for Explain, Check and assessment", () => {
  const sql = "DEFINE x = 1\nSELECT &x FROM dual;";
  expect(resolveQueryRunTarget(sql, "", 2, "selection-or-statement", "oracle")).toBe(
    "DEFINE x = 1",
  );
  expect(
    resolveQueryRunTarget(sql, "", 2, "selection-or-statement", "oracle", { sqlOnly: true }),
  ).toBe("");
  expect(
    resolveQueryRunTarget(sql, "", sql.length - 3, "selection-or-statement", "oracle", {
      sqlOnly: true,
    }),
  ).toBe("SELECT &x FROM dual;");
  expect(resolveQueryRunTarget(sql, "", 0, "all", "oracle", { sqlOnly: true })).toBe(sql);
});
