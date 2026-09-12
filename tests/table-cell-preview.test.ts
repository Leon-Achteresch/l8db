import { expect, test } from "bun:test";
import { TABLE_CELL_PREVIEW_LIMIT, tableCellPreview } from "../src/lib/table-cell-preview";

test("large cell previews stay bounded without changing the source value", () => {
  const row = Object.freeze({ payload: "prefix:" + "x".repeat(1_000_000) });
  const preview = tableCellPreview(row.payload);
  expect(preview.text.length).toBeLessThanOrEqual(TABLE_CELL_PREVIEW_LIMIT + 1);
  expect(preview.text.endsWith("…")).toBe(true);
  expect(row.payload.length).toBe(1_000_007);
});

test("truncating a cell never splits a UTF-16 surrogate pair", () => {
  const value = "x".repeat(TABLE_CELL_PREVIEW_LIMIT - 1) + "😀" + "suffix";
  expect(tableCellPreview(value).text).toBe("x".repeat(TABLE_CELL_PREVIEW_LIMIT - 1) + "…");
});

test("object previews do not serialize or traverse large payloads", () => {
  const payload = {
    toJSON: () => {
      throw new Error("payload must not be serialized while scrolling");
    },
  };
  expect(tableCellPreview(payload)).toEqual({ text: "{} Object", kind: "object" });
  expect(tableCellPreview(new Array(1_000_000))).toEqual({
    text: "[] Array(1000000)",
    kind: "object",
  });
});

test("NULL, empty strings and literal NULL stay distinguishable", () => {
  expect(tableCellPreview(null)).toEqual({ text: "NULL", kind: "null" });
  expect(tableCellPreview("")).toEqual({ text: "", kind: "text" });
  expect(tableCellPreview("NULL")).toEqual({ text: "NULL", kind: "text" });
});

test("narrow previews preserve type information and the original value", () => {
  const uuid = "01234567-89ab-cdef-0123-456789abcdef";
  expect(tableCellPreview(uuid, 8)).toEqual({ text: "01234567…", kind: "uuid" });
  expect(uuid).toHaveLength(36);
});
