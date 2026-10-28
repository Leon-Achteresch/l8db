import { expect, test } from "bun:test";
import { resolveQueryRunTarget } from "../src/lib/query-run-target";
import { QueryStatementOutlineCache } from "../src/lib/query-statement-outline";
import { splitSqlStatements, statementAtOffset } from "../src/lib/sql-statements";

const texts = (sql: string, dialect: string, blankLines = true) =>
  splitSqlStatements(sql, dialect, { blankLines }).statements.map((statement) => statement.text);

test("a blank line ends a statement only when the option is on", () => {
  const sql = "SELECT 1 FROM dual\n  \t\nSELECT 2 FROM dual -- tail\n\nSELECT 3\nFROM dual;";
  expect(texts(sql, "oracle", false)).toHaveLength(1);
  expect(texts(sql, "oracle")).toEqual([
    "SELECT 1 FROM dual",
    "SELECT 2 FROM dual -- tail",
    "SELECT 3\nFROM dual;",
  ]);
  expect(texts("SELECT 1\n\nSELECT 2", "postgres")).toEqual(["SELECT 1", "SELECT 2"]);
});

test("blank lines never split PL/SQL, routine bodies, batches or literals", () => {
  const block = "BEGIN\n  NULL;\n\n  NULL;\nEND;";
  const proc = "CREATE OR REPLACE PROCEDURE p IS\n\n  v NUMBER;\nBEGIN\n\n  NULL;\nEND p;";
  const inline =
    "WITH\n  FUNCTION f RETURN NUMBER IS\n\n  BEGIN RETURN 1; END;\nSELECT f FROM dual";
  expect(texts(`${block}\n${proc}\n${inline}\n/\nSELECT 'a\n\nb' FROM dual`, "oracle")).toEqual([
    block,
    proc,
    inline,
    "SELECT 'a\n\nb' FROM dual",
  ]);
  const mssql = "CREATE PROCEDURE dbo.p AS\nBEGIN\n\n  SELECT 1;\nEND";
  expect(texts(`${mssql}\nGO\nSELECT 2`, "mssql")).toEqual([mssql, "SELECT 2"]);
  const mysql = "CREATE PROCEDURE p() BEGIN\n\n  SELECT 1;\nEND;";
  expect(texts(`${mysql}\n\nSELECT 2`, "mysql")).toEqual([mysql, "SELECT 2"]);
  expect(texts("DELIMITER //\nSELECT 1\n\nSELECT 2//", "mysql")).toEqual(["SELECT 1\n\nSELECT 2"]);
});

test("statement at the cursor and the outline follow the option", () => {
  const sql = "SELECT 1 FROM dual\n\nSELECT 2 FROM dual";
  const offset = sql.indexOf("2");
  expect(statementAtOffset(sql, offset, "oracle")?.text).toBe(sql);
  expect(statementAtOffset(sql, offset, "oracle", { blankLines: true })?.text).toBe(
    "SELECT 2 FROM dual",
  );
  expect(
    resolveQueryRunTarget(sql, "", offset, "selection-or-statement", "oracle", {
      blankLines: true,
    }),
  ).toBe("SELECT 2 FROM dual");
  const cache = new QueryStatementOutlineCache();
  const joined = cache.read(sql, "oracle");
  expect(joined).toHaveLength(1);
  expect(cache.read(sql, "oracle")).toBe(joined);
  const split = cache.read(sql, "oracle", true);
  expect(split.map(({ line }) => line)).toEqual([1, 3]);
  expect(cache.read(sql, "oracle", true)).toBe(split);
});
