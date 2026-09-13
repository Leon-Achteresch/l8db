import { describe, expect, test } from "bun:test";
import { stableMarkerKey } from "../src/lib/row-markers";
import { destructiveStatements, scriptPolicyIssue } from "../src/lib/sql-safety";

describe("destructive SQL confirmation", () => {
  test("finds destructive commands throughout scripts", () => {
    expect(destructiveStatements("SELECT 1; DROP TABLE public.old; TRUNCATE public.logs; DELETE FROM users;", "postgres").map((entry) => entry.reason)).toEqual(["Tabelle löschen", "Tabelle leeren", "DELETE ohne WHERE"]);
  });

  test("ignores keywords in literals, identifiers and comments", () => {
    expect(destructiveStatements("SELECT 'DROP TABLE x; DELETE FROM y', \"TRUNCATE\"; /* DELETE; /* DROP TABLE x; */ */ -- TRUNCATE x;", "postgres")).toEqual([]);
    expect(destructiveStatements("CREATE FUNCTION f() RETURNS text AS $$ BEGIN RETURN 'DELETE FROM x'; END; $$ LANGUAGE plpgsql;", "postgres")).toEqual([]);
    expect(destructiveStatements("SELECT q'[DELETE FROM x;]' FROM dual", "oracle")).toEqual([]);
  });

  test("a WHERE in a subquery does not protect an outer DELETE", () => {
    expect(destructiveStatements("DELETE FROM t USING (SELECT * FROM x WHERE id = 2) s RETURNING t.*", "postgres")).toHaveLength(1);
    expect(destructiveStatements("DELETE FROM t WHERE id IN (SELECT id FROM x)", "postgres")).toEqual([]);
  });

  test("detects unfiltered deletion inside a data-modifying CTE", () => {
    expect(destructiveStatements("WITH deleted AS (DELETE FROM t RETURNING *) SELECT * FROM deleted WHERE id = 1", "postgres")).toHaveLength(1);
  });

  test("does not interpret non-SQL query languages as SQL", () => {
    expect(destructiveStatements('{"find":"DROP TABLE"}', "mongodb")).toEqual([]);
    expect(destructiveStatements('GET "DELETE FROM t"', "redis")).toEqual([]);
  });
});

test("does not confuse grants and escaped literals with destructive commands", () => {
  expect(destructiveStatements("GRANT DELETE, TRUNCATE ON TABLE t TO user1", "postgres")).toEqual([]);
  expect(destructiveStatements(String.raw`SELECT '\'; DELETE FROM t`, "postgres")).toHaveLength(1);
  expect(destructiveStatements(String.raw`SELECT 'a\'; DELETE FROM t; b'; SELECT 2`, "mysql")).toEqual([]);
});

test("managed scripts reject implicit commits and SQL transaction control", () => {
  expect(scriptPolicyIssue("CREATE TABLE t(id int)", "oracle", true)).toContain("implizitem Commit");
  expect(scriptPolicyIssue("CREATE TABLE t(id int)", "postgres", true)).toBeNull();
  expect(scriptPolicyIssue("COMMIT", "postgres", false)).toContain("Transaktionsbefehle");
  expect(scriptPolicyIssue("BEGIN NULL; END;\n/", "oracle", true)).toBeNull();
});

describe("stable row markers", () => {
  test("retains identity when row objects or values change", () => {
    expect(stableMarkerKey({ id: 7, name: "before" }, ["id"])).toBe(stableMarkerKey({ id: 7, name: "after" }, ["id"]));
    expect(stableMarkerKey({ id: 7, tenant: "a" }, ["tenant", "id"])).not.toBe(stableMarkerKey({ id: 7, tenant: "b" }, ["tenant", "id"]));
  });

  test("does not invent primary keys for arbitrary query results", () => {
    expect(stableMarkerKey({ id: 1 })).toBeUndefined();
    expect(stableMarkerKey({ __ctid__: "(0,2)" })).toBe("row:(0,2)");
  });
});
