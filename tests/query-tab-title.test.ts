import { describe, expect, test } from "bun:test";

import { queryTabLabel, queryTitleFromSql } from "../src/lib/query-tab-title";

const cases: Array<[string, string | null]> = [
  ["select u.* from public.users u join orders o on o.user_id = u.id", "Select users"],
  ["INSERT INTO orders (id) VALUES (1)", "Insert orders"],
  ['update "Customers" set x = 1', "Update Customers"],
  ["-- note\ndelete from `logs` where 1=1", "Delete logs"],
  ["create table if not exists app.events (id int)", "Create events"],
  ["drop index idx_foo", "Drop idx_foo"],
  ["with t as (select 1 from a) select * from b", "Select b"],
  ["select 1", "Select"],
  ["", null],
  ["foo bar", null],
  ["select * from (select * from inner_t) sub join outer_t o on 1=1", "Select outer_t"],
  ["select * from (select * from inner_t) sub", "Select"],
  [
    "with a as (select 1 from x), b as (select * from a where y in (select z from w)) update target set c = 1 from b",
    "Update target",
  ],
  ["insert into archive select * from live where created < now()", "Insert archive"],
  ["select 'from fake' as s, /* from comment */ id from real_table", "Select real_table"],
  [
    "create or replace function public.do_it(p int) returns void as $$ select 1 from nope $$ language sql",
    "Create do_it",
  ],
  ["create unique index concurrently idx_x on public.accounts (email)", "Create accounts"],
  ["create materialized view mv_sales as select * from sales", "Create mv_sales"],
  ["explain analyze select * from big_table", "Explain big_table"],
  ["explain (analyze, buffers) select * from big_table", "Explain big_table"],
  ["set search_path = app; select * from things;", "Select things"],
  ["begin; update accounts set b = 0; commit;", "Update accounts"],
  ["DO $$ begin perform 1 from x; end $$;", "Block"],
  ["declare v int; begin select 1 into v from dual; end;", "Block"],
  ["truncate table only staging.events", "Truncate events"],
  ["alter table users add column age int", "Alter users"],
  ["call refresh_stats()", "Call refresh_stats"],
  ["values (1), (2)", "Select"],
  ["(select * from a) union (select * from b)", "Select a"],
  ["select * from [dbo].[Users]", "Select Users"],
  ["select * from `db`.`tbl`", "Select tbl"],
  ["insert into t (a) values (1) on conflict do nothing", "Insert t"],
  ["grant select on users to reader", "Grant users"],
];

describe("queryTitleFromSql", () => {
  for (const [sql, expected] of cases) {
    test(sql || "<empty>", () => {
      expect(queryTitleFromSql(sql)).toBe(expected);
    });
  }
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
