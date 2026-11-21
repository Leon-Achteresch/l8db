import { describe, expect, test } from "bun:test";
import { stableMarkerKey } from "../src/lib/row-markers";
import { destructiveStatements, scriptPolicyIssue } from "../src/lib/sql-safety";

describe("destructive SQL confirmation", () => {
  test("finds destructive commands throughout scripts", () => {
    expect(
      destructiveStatements(
        "SELECT 1; DROP TABLE public.old; TRUNCATE public.logs; DELETE FROM users;",
        "postgres",
      ).map((entry) => entry.reason),
    ).toEqual(["Tabelle löschen", "Tabelle leeren", "DELETE ohne WHERE"]);
  });

  test("ignores keywords in literals, identifiers and comments", () => {
    expect(
      destructiveStatements(
        "SELECT 'DROP TABLE x; DELETE FROM y', \"TRUNCATE\"; /* DELETE; /* DROP TABLE x; */ */ -- TRUNCATE x;",
        "postgres",
      ),
    ).toEqual([]);
    expect(
      destructiveStatements(
        "CREATE FUNCTION f() RETURNS text AS $$ BEGIN RETURN 'DELETE FROM x'; END; $$ LANGUAGE plpgsql;",
        "postgres",
      ),
    ).toEqual([]);
    expect(destructiveStatements("SELECT q'[DELETE FROM x;]' FROM dual", "oracle")).toEqual([]);
  });

  test("a WHERE in a subquery does not protect an outer DELETE", () => {
    expect(
      destructiveStatements(
        "DELETE FROM t USING (SELECT * FROM x WHERE id = 2) s RETURNING t.*",
        "postgres",
      ),
    ).toHaveLength(1);
    expect(
      destructiveStatements("DELETE FROM t WHERE id IN (SELECT id FROM x)", "postgres"),
    ).toEqual([]);
  });

  test("detects unfiltered deletion inside a data-modifying CTE", () => {
    expect(
      destructiveStatements(
        "WITH deleted AS (DELETE FROM t RETURNING *) SELECT * FROM deleted WHERE id = 1",
        "postgres",
      ),
    ).toHaveLength(1);
  });

  test("does not interpret non-SQL query languages as SQL", () => {
    expect(destructiveStatements('{"find":"DROP TABLE"}', "mongodb")).toEqual([]);
    expect(destructiveStatements('GET "DELETE FROM t"', "redis")).toEqual([]);
  });
});

test("does not confuse grants and escaped literals with destructive commands", () => {
  expect(destructiveStatements("GRANT DELETE, TRUNCATE ON TABLE t TO user1", "postgres")).toEqual(
    [],
  );
  expect(destructiveStatements(String.raw`SELECT '\'; DELETE FROM t`, "postgres")).toHaveLength(1);
  expect(
    destructiveStatements(String.raw`SELECT 'a\'; DELETE FROM t; b'; SELECT 2`, "mysql"),
  ).toEqual([]);
});

test("managed scripts reject implicit commits and SQL transaction control", () => {
  expect(scriptPolicyIssue("CREATE TABLE t(id int)", "mysql", true)).toContain("implizitem Commit");
  expect(scriptPolicyIssue("CREATE TABLE t(id int)", "oracle", true)).toBeNull();
  expect(scriptPolicyIssue("CREATE TABLE t(id int)", "postgres", true)).toBeNull();
  expect(scriptPolicyIssue("COMMIT", "postgres", false)).toContain("Transaktionsbefehle");
  expect(scriptPolicyIssue("BEGIN NULL; END;\n/", "oracle", true)).toBeNull();
});

describe("stable row markers", () => {
  test("retains identity when row objects or values change", () => {
    expect(stableMarkerKey({ id: 7, name: "before" }, ["id"])).toBe(
      stableMarkerKey({ id: 7, name: "after" }, ["id"]),
    );
    expect(stableMarkerKey({ id: 7, tenant: "a" }, ["tenant", "id"])).not.toBe(
      stableMarkerKey({ id: 7, tenant: "b" }, ["tenant", "id"]),
    );
  });

  test("does not invent primary keys for arbitrary query results", () => {
    expect(stableMarkerKey({ id: 1 })).toBeUndefined();
    expect(stableMarkerKey({ __ctid__: "(0,2)" })).toBe("row:(0,2)");
  });
});

test("erkennt das Löschen von Datenbanken, Schemas, Spalten und NoSQL-Daten", () => {
  const reasons = (sql: string, dialect: string, strict = false) =>
    destructiveStatements(sql, dialect, { strict }).map((entry) => entry.reason);
  expect(reasons("DROP SCHEMA s CASCADE; DROP DATABASE prod", "postgres")).toEqual([
    "Schema löschen",
    "Datenbank löschen",
  ]);
  expect(reasons("ALTER TABLE t DROP COLUMN a", "postgres")).toEqual(["Spalte löschen"]);
  expect(reasons("ALTER TABLE t DROP a", "mysql")).toEqual(["Spalte oder Bestandteil löschen"]);
  expect(reasons("ALTER TABLE t ALTER COLUMN a DROP NOT NULL", "postgres")).toEqual([]);
  expect(reasons("db.users.deleteMany({})", "mongodb")).toEqual(["Dokumente löschen"]);
  expect(reasons("db.users.find({})", "mongodb")).toEqual([]);
  expect(reasons("GET a\nFLUSHALL", "redis")).toEqual(["Alle Schlüssel löschen"]);
  expect(reasons("DEL a", "redis")).toEqual([]);
  expect(reasons("DEL a", "redis", true)).toEqual(["Schlüssel löschen"]);
});

describe("UPDATE und DELETE ohne WHERE auf jeder Verbindung", () => {
  const reasons = (sql: string, dialect: string) =>
    destructiveStatements(sql, dialect).map((entry) => entry.reason);

  test.each([
    ["postgres", "update accounts set balance = 0"],
    ["postgres", "WITH s AS (SELECT id FROM src WHERE ok) UPDATE t SET a = 1"],
    ["postgres", "UPDATE t SET a = u.a FROM u"],
    ["postgres", "UPDATE t SET a = (SELECT max(b) FROM u WHERE u.id = 1)"],
    ["postgres", "UPDATE t SET note = 'WHERE id = 1' -- WHERE id = 1\n"],
    ["postgres", "UPDATE t SET a = 1 /* WHERE id = 1 */"],
    ["postgres", "UPDATE t SET a = 1 RETURNING (SELECT 1 WHERE true)"],
    ["postgres", "WITH d AS (UPDATE t SET a = 1 RETURNING id) SELECT * FROM d"],
    ["mysql", "UPDATE a JOIN b ON a.id = b.id SET a.x = b.x"],
    ["mysql", "UPDATE t SET a = 1 # WHERE id = 1"],
    ["mssql", "UPDATE TOP (10) dbo.t SET a = 1"],
    ["mssql", "WITH c AS (SELECT * FROM t) UPDATE c SET a = 1"],
    ["oracle", "UPDATE t SET note = q'[WHERE x]'"],
    ["oracle", "BEGIN\n  IF x THEN UPDATE t SET a = 1; END IF;\nEND;"],
    ["sqlite", "UPDATE OR REPLACE t SET a = 1"],
  ])("%s: %s", (dialect, sql) => {
    expect(reasons(sql, dialect)).toEqual(["UPDATE ohne WHERE"]);
  });

  test.each([
    ["postgres", "DELETE FROM t USING u"],
    ["postgres", "WITH d AS (DELETE FROM t RETURNING *) SELECT * FROM d"],
    ["mysql", "DELETE a, b FROM a JOIN b ON a.id = b.id"],
    ["mssql", "DELETE TOP (5) FROM t"],
    ["oracle", "DELETE t"],
  ])("%s: %s", (dialect, sql) => {
    expect(reasons(sql, dialect)).toEqual(["DELETE ohne WHERE"]);
  });

  test.each([
    ["postgres", "UPDATE t SET a = 1 WHERE id = 1"],
    ["postgres", "UPDATE t SET a = u.a FROM u WHERE t.id = u.id"],
    ["postgres", "UPDATE t SET a = 1 WHERE CURRENT OF c"],
    ["postgres", "WITH d AS (DELETE FROM t WHERE id = 1 RETURNING *) SELECT * FROM d"],
    ["postgres", "SELECT 'update t set a = 1' AS x"],
    ["postgres", 'SELECT update_count, "update" FROM t -- UPDATE t SET a = 1'],
    ["postgres", "SELECT * FROM t WHERE id = 1 FOR UPDATE SKIP LOCKED"],
    ["postgres", "SELECT * FROM t FOR NO KEY UPDATE"],
    ["postgres", "INSERT INTO t VALUES (1) ON CONFLICT (id) DO UPDATE SET a = excluded.a"],
    [
      "postgres",
      "ALTER TABLE t ADD FOREIGN KEY (u) REFERENCES u ON DELETE CASCADE ON UPDATE SET NULL",
    ],
    ["postgres", "CREATE POLICY p ON t FOR UPDATE USING (true)"],
    ["postgres", "CREATE TRIGGER g BEFORE INSERT OR UPDATE ON t FOR EACH ROW EXECUTE FUNCTION f()"],
    ["postgres", "MERGE INTO t USING s ON t.id = s.id WHEN MATCHED THEN UPDATE SET a = s.a"],
    ["postgres", "ALTER DEFAULT PRIVILEGES GRANT SELECT, UPDATE ON TABLES TO app"],
    ["postgres", "GRANT UPDATE ON t TO app"],
    ["mysql", "INSERT INTO t VALUES (1) ON DUPLICATE KEY UPDATE a = VALUES(a)"],
    ["mysql", "UPDATE a JOIN b ON a.id = b.id SET a.x = b.x WHERE b.ok"],
    ["mysql", "CREATE TRIGGER g AFTER DELETE ON t FOR EACH ROW DELETE FROM log"],
    ["mssql", "UPDATE STATISTICS dbo.t"],
    ["mssql", "UPDATE TOP (10) t SET a = 1 OUTPUT inserted.id WHERE a = 0"],
    ["mssql", "CREATE OR ALTER PROCEDURE p AS UPDATE t SET a = 1"],
    ["oracle", "SELECT * FROM t WHERE id = 1 FOR UPDATE NOWAIT"],
    ["oracle", "CREATE OR REPLACE TRIGGER g BEFORE UPDATE ON t BEGIN NULL; END;"],
    ["sqlite", "INSERT INTO t VALUES (1) ON CONFLICT(id) DO UPDATE SET a = 2"],
  ])("%s ohne Warnung: %s", (dialect, sql) => {
    expect(reasons(sql, dialect)).toEqual([]);
  });

  test("WHERE in Unterabfragen zählt nicht als WHERE der Anweisung", () => {
    expect(reasons("DELETE FROM t USING (SELECT id FROM u WHERE ok) s", "postgres")).toEqual([
      "DELETE ohne WHERE",
    ]);
  });
});
