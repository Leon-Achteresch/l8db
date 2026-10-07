import { expect, test } from "bun:test";
import { objectRenameIssue, renameObjectTab } from "../src/lib/object-rename";
import { queueQuerySnippet, takeQuerySnippet } from "../src/lib/pending-query-snippets";

test("rename updates matching table and structure tabs while keeping other objects", () => {
  expect(
    renameObjectTab(
      { kind: "table", schema: "public", table: "orders" },
      "public",
      "orders",
      "archive",
      "table",
    ),
  ).toEqual({ kind: "table", schema: "public", table: "archive" });
  expect(
    renameObjectTab(
      { kind: "alter-table", schema: "public", table: "orders" },
      "public",
      "orders",
      "archive",
      "table",
    ),
  ).toEqual({ kind: "alter-table", schema: "public", table: "archive" });
  const other = { kind: "table" as const, schema: "sales", table: "orders" };
  expect(renameObjectTab(other, "public", "orders", "archive", "table")).toBe(other);
  const view = {
    kind: "table" as const,
    schema: "public",
    table: "orders",
    entityType: "view" as const,
  };
  expect(renameObjectTab(view, "public", "orders", "archive", "table")).toBe(view);
});

test("rename updates view editors without changing similarly named tables", () => {
  expect(
    renameObjectTab(
      { kind: "view-editor", schema: "public", view: "orders" },
      "public",
      "orders",
      "archive",
      "view",
    ),
  ).toEqual({ kind: "view-editor", schema: "public", view: "archive" });
  const table = { kind: "table" as const, schema: "public", table: "orders" };
  expect(renameObjectTab(table, "public", "orders", "archive", "view")).toBe(table);
});

test("rename validates empty, unchanged and unsupported names", () => {
  expect(objectRenameIssue("orders", " ")).not.toBeNull();
  expect(objectRenameIssue("orders", " orders ")).not.toBeNull();
  expect(objectRenameIssue("orders", 'bad"name')).not.toBeNull();
  expect(objectRenameIssue("orders", "bad\0name")).not.toBeNull();
  expect(objectRenameIssue("orders", "orders_archiv")).toBeNull();
});

test("a snippet is delivered once to its original editor after switching tabs", () => {
  queueQuerySnippet("query-a", `SELECT \${table}`);
  expect(takeQuerySnippet("query-b")).toBeUndefined();
  expect(takeQuerySnippet("query-a")).toBe(`SELECT \${table}`);
  expect(takeQuerySnippet("query-a")).toBeUndefined();
});
