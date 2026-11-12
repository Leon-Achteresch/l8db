import { expect, test } from "bun:test";
import { nextQueryTitle } from "../src/lib/table-tabs";

test("nextQueryTitle fills the lowest free slot per tab list", () => {
  expect(nextQueryTitle([])).toBe("Abfrage 1");
  expect(nextQueryTitle([{ kind: "query", id: "a", title: "Abfrage 1", sql: "" }])).toBe(
    "Abfrage 2",
  );
  expect(nextQueryTitle([{ kind: "query", id: "a", title: "Abfrage 2", sql: "" }])).toBe(
    "Abfrage 1",
  );
});
