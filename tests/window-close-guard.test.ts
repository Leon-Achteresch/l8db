import { expect, test } from "bun:test";
import type { Tab } from "../src/lib/table-tabs";
import { dirtyQueryFiles } from "../src/lib/table-tabs-dirty-files";

const query = (id: string, sql: string, savedSql = "select 1") =>
  ({ kind: "query", id, title: `${id}.sql`, sql, savedSql, filePath: `/tmp/${id}.sql` }) as Tab;

test("lists unsaved files of every connection once and marks the active connection", () => {
  const active = [query("a", "select 2"), query("clean", "select 1")];
  const files = dirtyQueryFiles(active, { one: active, two: [query("b", "select 3")] }, "one");
  expect(files).toEqual([
    { id: "a", title: "a.sql", connectionId: "one", active: true },
    { id: "b", title: "b.sql", connectionId: "two", active: false },
  ]);
  expect(dirtyQueryFiles([], { two: [query("b", "select 3")] }, "one")).toHaveLength(1);
  expect(dirtyQueryFiles([query("c", "select 1")], {}, null)).toEqual([]);
});
