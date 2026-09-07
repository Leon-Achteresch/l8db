import { describe, expect, test } from "bun:test";

import { splitSqlStatements, sqlToRun, statementAtOffset } from "../src/lib/sql-statements";

describe("splitSqlStatements", () => {
  test("splits simple statements and keeps offsets", () => {
    const sql = "SELECT 1;\nSELECT 2;";
    const { statements, unterminated } = splitSqlStatements(sql);
    expect(unterminated).toBe(false);
    expect(statements.map((s) => s.text)).toEqual(["SELECT 1;", "SELECT 2;"]);
    expect(sql.slice(statements[1].start, statements[1].end)).toBe("SELECT 2;");
  });

  test("keeps trailing statement without semicolon", () => {
    const { statements } = splitSqlStatements("SELECT 1;\n  SELECT 2\n\n");
    expect(statements.map((s) => s.text)).toEqual(["SELECT 1;", "SELECT 2"]);
  });

  test("ignores semicolons inside single quoted strings", () => {
    const { statements } = splitSqlStatements("SELECT 'a;b', 'it''s; ok';SELECT 2;");
    expect(statements.map((s) => s.text)).toEqual(["SELECT 'a;b', 'it''s; ok';", "SELECT 2;"]);
  });

  test("ignores semicolons inside escape strings", () => {
    const { statements } = splitSqlStatements("SELECT E'a\\';b';SELECT 2;");
    expect(statements).toHaveLength(2);
    expect(statements[1].text).toBe("SELECT 2;");
  });

  test("ignores semicolons inside quoted identifiers", () => {
    const { statements } = splitSqlStatements('SELECT "we;ird" FROM t;SELECT 2;');
    expect(statements.map((s) => s.text)).toEqual(['SELECT "we;ird" FROM t;', "SELECT 2;"]);
  });

  test("ignores semicolons inside line and block comments", () => {
    const sql = "SELECT 1 -- a;b\n;/* c;d */ SELECT 2;";
    const { statements } = splitSqlStatements(sql);
    expect(statements).toHaveLength(2);
    expect(statements[1].text).toBe("/* c;d */ SELECT 2;");
  });

  test("supports nested block comments", () => {
    const { statements } = splitSqlStatements("/* a /* b; */ c; */ SELECT 1;");
    expect(statements).toHaveLength(1);
  });

  test("ignores semicolons inside dollar quotes", () => {
    const sql =
      "CREATE FUNCTION f() RETURNS int AS $$ BEGIN; RETURN 1; END; $$ LANGUAGE plpgsql;\nSELECT 2;";
    const { statements } = splitSqlStatements(sql);
    expect(statements).toHaveLength(2);
    expect(statements[1].text).toBe("SELECT 2;");
  });

  test("supports tagged dollar quotes", () => {
    const { statements } = splitSqlStatements("SELECT $body$a;$$b;$body$;SELECT 2;");
    expect(statements).toHaveLength(2);
    expect(statements[0].text).toBe("SELECT $body$a;$$b;$body$;");
  });

  test("treats positional parameters as normal text", () => {
    const { statements, unterminated } = splitSqlStatements("SELECT * FROM t WHERE id = $1;");
    expect(unterminated).toBe(false);
    expect(statements).toHaveLength(1);
  });

  test("drops comment-only and empty segments", () => {
    const { statements } = splitSqlStatements(";;\n-- nur ein Kommentar\n");
    expect(statements).toHaveLength(0);
  });

  test("flags unterminated string", () => {
    expect(splitSqlStatements("SELECT 'abc").unterminated).toBe(true);
  });

  test("flags unterminated block comment", () => {
    expect(splitSqlStatements("SELECT 1; /* offen").unterminated).toBe(true);
  });

  test("flags unterminated dollar quote", () => {
    expect(splitSqlStatements("SELECT $$ offen").unterminated).toBe(true);
  });
});

describe("statementAtOffset", () => {
  const sql = "SELECT 1;\n\nSELECT 2;\n";

  test("finds statement at cursor inside it", () => {
    expect(statementAtOffset(sql, 3)?.text).toBe("SELECT 1;");
    expect(statementAtOffset(sql, sql.indexOf("SELECT 2") + 4)?.text).toBe("SELECT 2;");
  });

  test("includes the terminating semicolon position", () => {
    expect(statementAtOffset(sql, 9)?.text).toBe("SELECT 1;");
  });

  test("returns null in the gap between statements", () => {
    expect(statementAtOffset(sql, 10)).toBeNull();
  });

  test("returns null on empty input", () => {
    expect(statementAtOffset("   \n", 2)).toBeNull();
  });

  test("returns null when boundaries are unclear", () => {
    expect(statementAtOffset("SELECT 1; SELECT 'offen", 3)).toBeNull();
  });

  test("clamps out-of-range offsets", () => {
    expect(statementAtOffset("SELECT 1;", 999)?.text).toBe("SELECT 1;");
  });
});

test("sqlToRun runs only the selection when one exists", () => {
  expect(sqlToRun("SELECT 1; SELECT 2;", "SELECT 2;")).toBe("SELECT 2;");
  expect(sqlToRun("SELECT 1; SELECT 2;", "   \n ")).toBe("SELECT 1; SELECT 2;");
  expect(sqlToRun("SELECT 1;", "")).toBe("SELECT 1;");
});
