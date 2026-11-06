import { expect, test } from "bun:test";
import { nextQueryTitle } from "../src/lib/table-tabs";

test("nextQueryTitle fills the lowest free slot per tab list", () => {
  expect(nextQueryTitle([])).toBe("Query 1");
  expect(nextQueryTitle([{ kind: "query", id: "a", title: "Query 1", sql: "" }])).toBe("Query 2");
  expect(nextQueryTitle([{ kind: "query", id: "a", title: "Query 2", sql: "" }])).toBe("Query 1");
});
