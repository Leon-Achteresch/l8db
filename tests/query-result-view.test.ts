import { expect, test } from "bun:test";
import type { DetailedColumnInfo, ForeignKeyInfo } from "../src/lib/db";
import {
  originsByName,
  QUERY_RESULT_SCHEMA,
  queryCountSql,
  queryPageSql,
  readCount,
  resultColumnDetails,
  resultForeignKeys,
  singleSourceTable,
  supportsQueryResultView,
  viewableSelect,
} from "../src/lib/query-result-view";

test("viewableSelect accepts single SELECT and WITH statements only", () => {
  expect(viewableSelect("SELECT * FROM users;", "postgres")).toBe("SELECT * FROM users");
  expect(viewableSelect("with a as (select 1) select * from a", "postgres")).toBe(
    "with a as (select 1) select * from a",
  );
  expect(viewableSelect("SELECT 1; SELECT 2", "postgres")).toBeNull();
  expect(viewableSelect("UPDATE users SET a = 1", "postgres")).toBeNull();
  expect(viewableSelect("SELECT * INTO copy FROM users", "postgres")).toBeNull();
  expect(viewableSelect("SELECT * FROM users FOR UPDATE", "postgres")).toBeNull();
  expect(viewableSelect("SELECT * FROM users", "redis")).toBeNull();
  expect(supportsQueryResultView("mssql")).toBe(true);
  expect(supportsQueryResultView("mongodb")).toBe(false);
});

test("queryPageSql wraps the query as a derived table per dialect", () => {
  const options = {
    columns: ["id", "name"],
    filter: `"name" = 'a'`,
    sort: { column: "id", desc: true },
    limit: 100,
    offset: 200,
  };
  expect(queryPageSql("SELECT id, name FROM users -- note", "postgres", options)).toBe(
    `SELECT * FROM (\nSELECT id, name FROM users -- note\n) AS l8db_q("id", "name")\nWHERE "name" = 'a'\nORDER BY "id" DESC\nLIMIT 100 OFFSET 200`,
  );
  expect(
    queryPageSql("SELECT id FROM users", "mysql", { ...options, filter: "", sort: null }),
  ).toBe("SELECT * FROM (\nSELECT id FROM users\n) AS l8db_q\nLIMIT 100 OFFSET 200");
  expect(
    queryPageSql("SELECT id FROM users ORDER BY id", "mssql", {
      ...options,
      columns: ["id"],
      filter: "",
      sort: null,
    }),
  ).toBe(
    "SELECT * FROM (\nSELECT id FROM users ORDER BY id\nOFFSET 0 ROWS\n) AS l8db_q([id])\nORDER BY (SELECT NULL)\nOFFSET 200 ROWS FETCH NEXT 100 ROWS ONLY",
  );
  expect(
    queryPageSql("SELECT id FROM users", "oracle", { ...options, filter: "", sort: null }),
  ).toBe(
    "SELECT * FROM (\nSELECT id FROM users\n) l8db_q\nOFFSET 200 ROWS FETCH NEXT 100 ROWS ONLY",
  );
});

test("queryCountSql caps the count and readCount reads the first value", () => {
  expect(queryCountSql("SELECT id FROM users", "sqlite", ["id"], "", 10)).toBe(
    "SELECT COUNT(*) AS l8db_count FROM (\nSELECT 1 AS l8db_one FROM (\nSELECT id FROM users\n) AS l8db_q\nLIMIT 11\n) AS l8db_c",
  );
  expect(queryCountSql("SELECT id FROM users", "postgres", ["id"], `"id" > 1`)).toBe(
    `SELECT COUNT(*) AS l8db_count FROM (\nSELECT id FROM users\n) AS l8db_q("id")\nWHERE "id" > 1`,
  );
  expect(readCount([{ L8DB_COUNT: "42" }])).toBe(42);
  expect(readCount([])).toBe(0);
});

test("singleSourceTable detects plain single-table selects", () => {
  expect(singleSourceTable("SELECT * FROM users", "mysql")).toEqual({
    schema: null,
    table: "users",
  });
  expect(singleSourceTable(`SELECT u.id FROM "app"."Users" u WHERE u.id > 1`, "postgres")).toEqual({
    schema: "app",
    table: "Users",
  });
  expect(singleSourceTable("SELECT * FROM [dbo].[Orders] AS o ORDER BY 1", "mssql")).toEqual({
    schema: "dbo",
    table: "Orders",
  });
  expect(singleSourceTable("SELECT * FROM a JOIN b ON a.id = b.a_id", "mysql")).toBeNull();
  expect(singleSourceTable("SELECT * FROM a, b", "mysql")).toBeNull();
  expect(singleSourceTable("SELECT * FROM (SELECT 1) x", "mysql")).toBeNull();
});

test("result foreign keys and column details are mapped onto result columns", () => {
  const columns = ["order_id", "customer", "name"];
  const origins = [
    { schema: "public", table: "orders", column: "id" },
    { schema: "public", table: "orders", column: "customer_id" },
    null,
  ];
  const outgoing: ForeignKeyInfo = {
    constraint_name: "orders_customer_fk",
    from_schema: "public",
    from_table: "orders",
    from_column: "customer_id",
    to_schema: "public",
    to_table: "customers",
    to_column: "id",
  };
  const incoming: ForeignKeyInfo = {
    constraint_name: "items_order_fk",
    from_schema: "public",
    from_table: "items",
    from_column: "order_id",
    to_schema: "public",
    to_table: "orders",
    to_column: "id",
  };
  const detail = (name: string, primary: boolean): DetailedColumnInfo => ({
    name,
    data_type: "integer",
    is_nullable: !primary,
    column_default: null,
    is_primary_key: primary,
    ordinal_position: 1,
    character_maximum_length: null,
  });
  const sources = [
    {
      schema: "public",
      table: "orders",
      columns: [detail("id", true), detail("customer_id", false)],
      foreignKeys: [outgoing, incoming],
    },
  ];
  expect(resultForeignKeys(columns, origins, sources, "q")).toEqual([
    { ...incoming, to_schema: QUERY_RESULT_SCHEMA, to_table: "q", to_column: "order_id" },
    { ...outgoing, from_schema: QUERY_RESULT_SCHEMA, from_table: "q", from_column: "customer" },
  ]);
  const details = resultColumnDetails(columns, origins, [null, null, "text"], sources);
  expect(details.map((entry) => [entry.name, entry.is_primary_key, entry.data_type])).toEqual([
    ["order_id", true, "integer"],
    ["customer", false, "integer"],
    ["name", false, "text"],
  ]);
  expect(originsByName(["ID", "missing"], "dbo", "t", ["id"])).toEqual([
    { schema: "dbo", table: "t", column: "id" },
    null,
  ]);
});
