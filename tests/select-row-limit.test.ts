import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { applySelectRowLimit } from "../src/lib/select-row-limit";

const limited = (sql: string, dialect = "postgres") => applySelectRowLimit(sql, dialect, 100);

describe("SELECT row limit", () => {
  test("limits SELECTs without changing literals or trailing comments", () => {
    expect(limited("SELECT 'limit 5;' -- trailing comment")).toBe(
      "SELECT 'limit 5;' -- trailing comment\nLIMIT 100\n",
    );
    expect(limited("SELECT * FROM users; -- done")).toBe(
      "SELECT * FROM users\nLIMIT 100\n; -- done",
    );
  });
  test("preserves explicit outer limits but limits subqueries and CTE results", () => {
    for (const sql of [
      "SELECT * FROM t LIMIT 5",
      "SELECT TOP (5) * FROM t",
      "SELECT * FROM t FETCH FIRST 5 ROWS ONLY",
    ])
      expect(limited(sql)).toBe(sql);
    expect(limited("WITH t AS (SELECT * FROM users LIMIT 5) SELECT * FROM t")).toEndWith(
      "\nLIMIT 100\n",
    );
    expect(limited("SELECT * FROM (SELECT * FROM users LIMIT 5) t")).toEndWith("\nLIMIT 100\n");
  });
  test("keeps mutations, including data modifying CTEs, unchanged", () => {
    for (const sql of [
      "UPDATE users SET name = 'x'",
      "INSERT INTO users SELECT * FROM old_users",
      "SELECT * INTO backup FROM users",
      "WITH t AS (DELETE FROM users RETURNING *) SELECT * FROM t",
      "EXPLAIN SELECT * FROM users",
    ])
      expect(limited(sql)).toBe(sql);
  });
  test("limits individual SELECTs in mixed scripts", () => {
    expect(limited("SELECT 1; UPDATE t SET a = 1; SELECT 2;")).toBe(
      "SELECT 1\nLIMIT 100\n; UPDATE t SET a = 1; SELECT 2\nLIMIT 100\n;",
    );
  });
  test("uses dialect-specific row limits", () => {
    expect(limited("SELECT * FROM t", "oracle")).toEndWith("\nFETCH FIRST 100 ROWS ONLY\n");
    expect(limited("SELECT * FROM t", "mssql")).toEndWith(
      "\nORDER BY 1 OFFSET 0 ROWS FETCH NEXT 100 ROWS ONLY\n",
    );
    expect(limited("SELECT * FROM t ORDER BY id OFFSET 5 ROWS", "mssql")).toEndWith(
      "\nFETCH NEXT 100 ROWS ONLY\n",
    );
    expect(limited("SELECT * FROM t OFFSET 5")).toBe("SELECT * FROM t \nLIMIT 100\nOFFSET 5");
    expect(limited("SELECT * FROM t FORMAT JSON", "clickhouse")).toBe(
      "SELECT * FROM t \nLIMIT 100\nFORMAT JSON",
    );
  });
  test("handles locks and keyword column names", () => {
    expect(limited("SELECT * FROM t FOR UPDATE")).toBe("SELECT * FROM t \nLIMIT 100\nFOR UPDATE");
    expect(limited("SELECT format, settings FROM t")).toEndWith("\nLIMIT 100\n");
    expect(limited("SELECT * FROM t ALLOW FILTERING", "cassandra")).toBe(
      "SELECT * FROM t \nLIMIT 100\nALLOW FILTERING",
    );
    expect(limited("SELECT 1", "redis")).toBe("SELECT 1");
  });
  test("preserves parameter placeholders and ignores keyword strings", () => {
    expect(limited("SELECT * FROM t WHERE x = $1 AND y = 'FETCH'")).toEndWith("\nLIMIT 100\n");
    expect(limited("SELECT $$LIMIT$$")).toEndWith("\nLIMIT 100\n");
    expect(limited("SELECT q'[LIMIT]' FROM dual", "oracle")).toEndWith(
      "\nFETCH FIRST 100 ROWS ONLY\n",
    );
  });
  test("does not rewrite disabled, invalid or incomplete queries", () => {
    for (const limit of [0, -1, NaN, Infinity, 1.5, 100001])
      expect(applySelectRowLimit("SELECT 1", "postgres", limit)).toBe("SELECT 1");
    expect(limited("SELECT 'oops")).toBe("SELECT 'oops");
  });
});

test("executes limited SELECTs, CTEs and unions against SQLite", () => {
  const db = new Database(":memory:");
  try {
    db.exec("CREATE TABLE items (id INTEGER); INSERT INTO items VALUES (1), (2), (3), (4);");
    for (const sql of [
      "SELECT * FROM items; -- done",
      "WITH t AS (SELECT * FROM items) SELECT * FROM t",
      "SELECT id FROM items UNION ALL SELECT id FROM items ORDER BY id",
    ]) {
      expect(db.query(applySelectRowLimit(sql, "sqlite", 2)).all()).toHaveLength(2);
    }
    expect(
      db.query(applySelectRowLimit("SELECT * FROM items WHERE id > ?", "sqlite", 2)).all(1),
    ).toHaveLength(2);
    expect(
      db.query(applySelectRowLimit("SELECT * FROM items LIMIT 1", "sqlite", 2)).all(),
    ).toHaveLength(1);
  } finally {
    db.close();
  }
});
