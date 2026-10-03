import { describe, expect, test } from "bun:test";
import {
  expandSessionViews,
  parseLeadingWith,
  referencedSessionViews,
  type SessionView,
  scopeKey,
  temporaryViewMode,
  useSessionViewsStore,
} from "../src/lib/session-views";

const view = (name: string, sql: string): SessionView => ({ name, sql, columns: [], createdAt: 0 });
const views = [
  view("active_users", "SELECT * FROM users WHERE active = true"),
  view("active_orders", "SELECT o.* FROM orders o JOIN active_users u ON u.id = o.user_id"),
];

describe("session views", () => {
  test("mode per kind", () => {
    expect(temporaryViewMode("sqlite")).toBe("native");
    expect(temporaryViewMode("postgres")).toBe("emulated");
    expect(temporaryViewMode("mssql")).toBe("emulated");
    expect(temporaryViewMode("cassandra")).toBeNull();
    expect(temporaryViewMode("redis")).toBeNull();
  });

  test("finds references outside strings, comments, qualified names and calls", () => {
    const sql = `-- active_users\nSELECT 'active_users', s.active_users, active_users(1) FROM "Active_Users" x`;
    expect(referencedSessionViews(sql, views, "postgres").map((v) => v.name)).toEqual([
      "active_users",
    ]);
    expect(referencedSessionViews("SELECT 1", views, "postgres")).toEqual([]);
  });

  test("injects a CTE for a referenced view", () => {
    expect(expandSessionViews("SELECT * FROM active_users;", views, "postgres")).toBe(
      "WITH active_users AS (\nSELECT * FROM users WHERE active = true\n)\nSELECT * FROM active_users;",
    );
  });

  test("orders dependencies before dependents", () => {
    const out = expandSessionViews("SELECT count(*) FROM active_orders", views, "mysql");
    expect(out.indexOf("active_users AS (")).toBeLessThan(out.indexOf("active_orders AS ("));
    expect(out.endsWith("SELECT count(*) FROM active_orders")).toBe(true);
  });

  test("merges with an existing WITH and respects shadowing", () => {
    const sql =
      "WITH RECURSIVE t(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM t WHERE n < 3) SELECT n FROM t, active_users";
    const out = expandSessionViews(sql, views, "postgres");
    expect(out.startsWith("WITH RECURSIVE active_users AS (")).toBe(true);
    expect(out).toContain(
      ",\nt(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM t WHERE n < 3)\nSELECT n FROM t, active_users",
    );
    const shadowed = "WITH active_users AS (SELECT 1) SELECT * FROM active_users";
    expect(expandSessionViews(shadowed, views, "postgres")).toBe(shadowed);
  });

  test("hoists a view's own WITH into the outer list", () => {
    const nested = [view("v", "WITH base AS (SELECT 1 AS n) SELECT n FROM base")];
    expect(expandSessionViews("SELECT * FROM v", nested, "mssql")).toBe(
      "WITH base AS (SELECT 1 AS n),\nv AS (\nSELECT n FROM base\n)\nSELECT * FROM v",
    );
  });

  test("quotes names that are not plain identifiers", () => {
    const odd = [view("Meine View", "SELECT 1")];
    expect(expandSessionViews('SELECT * FROM "Meine View"', odd, "postgres")).toStartWith(
      'WITH "Meine View" AS (',
    );
    expect(expandSessionViews("SELECT * FROM [Meine View]", odd, "mssql")).toStartWith(
      "WITH [Meine View] AS (",
    );
  });

  test("rejects non-select usage and cycles", () => {
    expect(() => expandSessionViews("DELETE FROM active_users", views, "postgres")).toThrow(
      /nur in SELECT/,
    );
    const cyclic = [view("a", "SELECT * FROM b"), view("b", "SELECT * FROM a")];
    expect(() => expandSessionViews("SELECT * FROM a", cyclic, "postgres")).toThrow(/zirkulär/);
  });

  test("expands each statement of a script independently", () => {
    const out = expandSessionViews("SELECT 1;\nSELECT * FROM active_users;", views, "postgres");
    expect(out).toBe(
      "SELECT 1;\nWITH active_users AS (\nSELECT * FROM users WHERE active = true\n)\nSELECT * FROM active_users;",
    );
  });

  test("parses leading WITH lists", () => {
    const parsed = parseLeadingWith(
      "WITH a AS (SELECT 1), b (x) AS MATERIALIZED (SELECT 2) SELECT * FROM a, b",
      "postgres",
    );
    expect(parsed?.ctes.map((c) => c.name)).toEqual(["a", "b"]);
    expect(parsed?.body).toBe("SELECT * FROM a, b");
    expect(parseLeadingWith("SELECT 1", "postgres")).toBeNull();
  });

  test("store scopes by connection and database and clears per connection", () => {
    const store = useSessionViewsStore.getState();
    store.add(scopeKey("c1", "db"), views[0]);
    store.add(scopeKey("c1", "other"), views[1]);
    store.add(scopeKey("c2", null), views[0]);
    expect(useSessionViewsStore.getState().views[scopeKey("c1", "db")]).toHaveLength(1);
    store.remove(scopeKey("c1", "db"), "ACTIVE_USERS");
    expect(useSessionViewsStore.getState().views[scopeKey("c1", "db")]).toHaveLength(0);
    store.clearConnection("c1");
    expect(Object.keys(useSessionViewsStore.getState().views)).toEqual([scopeKey("c2", null)]);
  });
});
