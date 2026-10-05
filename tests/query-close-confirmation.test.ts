import { expect, test } from "bun:test";
import { queryNeedsCloseConfirmation } from "../src/lib/table-tabs";

const tab = (sql: string, filePath?: string) => ({
  kind: "query" as const,
  id: "a",
  title: "Query 1",
  sql,
  filePath,
});

test("closing a scratch query only asks when it does more than read", () => {
  expect(queryNeedsCloseConfirmation(tab(""))).toBe(false);
  expect(queryNeedsCloseConfirmation(tab("SELECT 1;"))).toBe(false);
  expect(
    queryNeedsCloseConfirmation(
      tab("-- x\nselect * from a;\nWITH b AS (SELECT 1) SELECT * FROM b"),
    ),
  ).toBe(false);
  expect(queryNeedsCloseConfirmation(tab("SELECT 1; DELETE FROM a"))).toBe(true);
  expect(queryNeedsCloseConfirmation(tab("UPDATE a SET b = 1"))).toBe(true);
  expect(queryNeedsCloseConfirmation(tab("SELECT 1", "/tmp/a.sql"))).toBe(true);
});
