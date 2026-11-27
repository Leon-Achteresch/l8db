import { expect, test } from "bun:test";
import { hasUnexecutedQueryChanges, withoutRepeatedSql } from "../src/lib/table-tabs/query-tabs";
import type { QueryTab, Tab } from "../src/lib/table-tabs/types";

const sql = "SELECT * FROM artikel WHERE id = 1;\n".repeat(20_000);

test("persisted query tabs store an executed statement only once", () => {
  const executed: QueryTab = { kind: "query", id: "a", title: "A", sql, lastExecutedSql: sql };
  const edited: QueryTab = { ...executed, id: "b", lastExecutedSql: "SELECT 1" };
  const table: Tab = { kind: "table", schema: "S", table: "T" };
  const stored = withoutRepeatedSql(executed);
  expect("lastExecutedSql" in stored).toBe(false);
  expect(JSON.stringify(stored).length).toBeLessThan(JSON.stringify(executed).length * 0.51);
  expect(hasUnexecutedQueryChanges(stored)).toBe(hasUnexecutedQueryChanges(executed));
  expect(withoutRepeatedSql(edited)).toBe(edited);
  expect(withoutRepeatedSql(table)).toBe(table);
  expect(executed.lastExecutedSql).toBe(sql);
});
