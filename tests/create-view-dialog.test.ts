import { describe, expect, test } from "bun:test";
import { createViewSql, isViewableSelect } from "../src/features/query/create-view-dialog";

describe("create view from result", () => {
  test("accepts single select statements only", () => {
    expect(isViewableSelect("SELECT 1;")).toBe(true);
    expect(isViewableSelect("  with x as (select 1) select * from x")).toBe(true);
    expect(isViewableSelect("UPDATE t SET a = 1")).toBe(false);
    expect(isViewableSelect("SELECT 1; SELECT 2")).toBe(false);
  });

  test("quotes the view name per dialect and strips the trailing semicolon", () => {
    expect(createViewSql("sales.v x", "SELECT 1;", "postgres")).toBe(
      'CREATE VIEW "sales"."v x" AS SELECT 1',
    );
    expect(createViewSql("v", "SELECT 1", "mysql")).toBe("CREATE VIEW `v` AS SELECT 1");
    expect(createViewSql("[dbo].v", "SELECT 1", "mssql")).toBe("CREATE VIEW [dbo].[v] AS SELECT 1");
    expect(createViewSql("v", "SELECT 1", "sqlite", true)).toBe('CREATE TEMP VIEW "v" AS SELECT 1');
  });
});
