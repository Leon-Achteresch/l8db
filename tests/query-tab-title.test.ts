import { describe, expect, test } from "bun:test";

import { queryTabLabel, queryTitleFromSql } from "../src/lib/query-tab-title";

describe("queryTitleFromSql", () => {
  test("select with schema and join", () => {
    expect(
      queryTitleFromSql("select u.* from public.users u join orders o on o.user_id = u.id"),
    ).toBe("Select users");
  });
  test("insert / update / delete", () => {
    expect(queryTitleFromSql("INSERT INTO orders (id) VALUES (1)")).toBe("Insert orders");
    expect(queryTitleFromSql('update "Customers" set x = 1')).toBe("Update Customers");
    expect(queryTitleFromSql("-- note\ndelete from `logs` where 1=1")).toBe("Delete logs");
  });
  test("ddl", () => {
    expect(queryTitleFromSql("create table if not exists app.events (id int)")).toBe(
      "Create events",
    );
    expect(queryTitleFromSql("drop index idx_foo")).toBe("Drop idx_foo");
  });
  test("cte uses main statement", () => {
    expect(queryTitleFromSql("with t as (select 1 from a) select * from b")).toBe("Select b");
  });
  test("no object / unknown", () => {
    expect(queryTitleFromSql("select 1")).toBe("Select");
    expect(queryTitleFromSql("")).toBeNull();
    expect(queryTitleFromSql("foo bar")).toBeNull();
  });
});

describe("queryTabLabel", () => {
  test("keeps custom and file titles", () => {
    expect(queryTabLabel({ title: "Mein Report", sql: "select * from x" })).toBe("Mein Report");
    expect(queryTabLabel({ title: "Query 1", sql: "select * from x", filePath: "/a.sql" })).toBe(
      "Query 1",
    );
  });
  test("falls back to Query n", () => {
    expect(queryTabLabel({ title: "Query 2", sql: "" })).toBe("Query 2");
    expect(queryTabLabel({ title: "Query 2", sql: "select * from x" })).toBe("Select x");
  });
});
