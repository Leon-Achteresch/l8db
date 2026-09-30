import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { applySelectRowLimit } from "../src/lib/select-row-limit";

const limited = (sql: string, dialect = "postgres") => applySelectRowLimit(sql, dialect, 100);

describe("SELECT row limit", () => {
  test("defaults to 1000 rows and lets larger native limits override it", () => {
    for (const dialect of [
      "postgres",
      "mysql",
      "sqlite",
      "sqlite_http",
      "duckdb",
      "clickhouse",
      "cassandra",
      "athena",
      "bigquery",
      "snowflake",
      "s3",
    ]) {
      expect(applySelectRowLimit("SELECT * FROM t", dialect)).toEndWith("\nLIMIT 1000\n");
      expect(applySelectRowLimit("SELECT * FROM t LIMIT 5000", dialect)).toBe(
        "SELECT * FROM t LIMIT 5000",
      );
    }
    expect(applySelectRowLimit("SELECT * FROM t", "mssql")).toBe("SELECT TOP (1000) * FROM t");
    expect(applySelectRowLimit("SELECT TOP (5000) * FROM t", "mssql")).toBe(
      "SELECT TOP (5000) * FROM t",
    );
    expect(applySelectRowLimit("SELECT * FROM t", "oracle")).toEndWith(
      "\nFETCH FIRST 1000 ROWS ONLY\n",
    );
    expect(applySelectRowLimit("SELECT * FROM t FETCH FIRST 5000 ROWS ONLY", "oracle")).toBe(
      "SELECT * FROM t FETCH FIRST 5000 ROWS ONLY",
    );
  });
  test("preserves native unlimited and parameterized limits", () => {
    for (const sql of [
      "SELECT * FROM t LIMIT ALL",
      "SELECT * FROM t LIMIT /* explicit */ 5000",
      "SELECT * FROM t LIMIT NULL",
      "SELECT * FROM t LIMIT $1",
      "SELECT * FROM t LIMIT :rows",
      "SELECT * FROM t LIMIT (2000 + 1)",
    ])
      expect(applySelectRowLimit(sql, "postgres")).toBe(sql);
    for (const sql of [
      "SELECT DISTINCT TOP (@rows) id FROM t",
      "SELECT TOP 10 PERCENT * FROM t",
      "SELECT * FROM t ORDER BY id OFFSET 0 ROWS FETCH NEXT @rows ROWS ONLY",
    ])
      expect(applySelectRowLimit(sql, "mssql")).toBe(sql);
    for (const sql of [
      "SELECT * FROM t WHERE ROWNUM <= 5000",
      "SELECT * FROM t WHERE (ROWNUM <= 5000)",
      "SELECT * FROM t WHERE 5000 >= ROWNUM",
      "SELECT * FROM t FETCH NEXT :rows ROWS ONLY",
    ])
      expect(applySelectRowLimit(sql, "oracle")).toBe(sql);
  });
  test("places TOP after SELECT modifiers and outside CTEs", () => {
    expect(limited("SELECT DISTINCT id FROM t ORDER BY id", "mssql")).toBe(
      "SELECT DISTINCT TOP (100) id FROM t ORDER BY id",
    );
    expect(limited("WITH t AS (SELECT TOP 5 * FROM source) SELECT * FROM t", "mssql")).toBe(
      "WITH t AS (SELECT TOP 5 * FROM source) SELECT TOP (100) * FROM t",
    );
    expect(limited("SELECT id FROM a UNION ALL SELECT id FROM b ORDER BY id", "mssql")).toEndWith(
      "\nOFFSET 0 ROWS FETCH NEXT 100 ROWS ONLY\n",
    );
  });
  test("per-group limits still receive a global row limit", () => {
    expect(limited("SELECT * FROM t PER PARTITION LIMIT 2 ALLOW FILTERING", "cassandra")).toEndWith(
      "\nLIMIT 100\nALLOW FILTERING",
    );
    expect(limited("SELECT * FROM t LIMIT 2 BY id", "clickhouse")).toEndWith("\nLIMIT 100\n");
  });
  test("uses ROWNUM for Oracle locking queries", () => {
    expect(limited("SELECT * FROM t FOR UPDATE", "oracle")).toBe(
      "SELECT * FROM t \nWHERE ROWNUM <= 100\nFOR UPDATE",
    );
    expect(limited("SELECT * FROM t WHERE a = 1 OR b = 2 FOR UPDATE", "oracle")).toBe(
      "SELECT * FROM t WHERE (  a = 1 OR b = 2 \n) AND ROWNUM <= 100\nFOR UPDATE",
    );
  });
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
    expect(limited("SELECT * FROM t", "mssql")).toBe("SELECT TOP (100) * FROM t");
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

test("SQLite default fetches 1000 rows while native LIMIT can fetch more", () => {
  const db = new Database(":memory:");
  try {
    db.exec(
      "CREATE TABLE many_items (id INTEGER); WITH RECURSIVE n(id) AS (SELECT 1 UNION ALL SELECT id + 1 FROM n WHERE id < 1500) INSERT INTO many_items SELECT id FROM n;",
    );
    expect(db.query(applySelectRowLimit("SELECT * FROM many_items", "sqlite")).all()).toHaveLength(
      1000,
    );
    expect(
      db.query(applySelectRowLimit("SELECT * FROM many_items LIMIT 1200", "sqlite")).all(),
    ).toHaveLength(1200);
  } finally {
    db.close();
  }
});
