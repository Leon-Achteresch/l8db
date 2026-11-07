import { describe, expect, test } from "bun:test";
import {
  cellEditCommitValue,
  needsMultilineEditor,
} from "../src/features/table/data-table/use-cell-editing";
import { buildRowUpdates, changedRowValues, valueToUpdateText } from "../src/lib/cell-editor";

const cell = (original: unknown, value: string) => ({
  ctid: "(0,1)",
  rowIndex: 0,
  columnId: "note",
  value,
  originalValues: { id: 1, note: original },
});

describe("cellEditCommitValue", () => {
  test("leaves an untouched empty string unchanged instead of writing NULL", () => {
    const editing = cell("", "");
    const next = cellEditCommitValue(editing, undefined);
    expect(next).toBe("");
    const updates = buildRowUpdates(["id", "note"], editing.originalValues, "note", next);
    expect(updates.note).toBe(valueToUpdateText(editing.originalValues.note));
  });

  test("keeps NULL for an untouched NULL cell", () => {
    expect(cellEditCommitValue(cell(null, ""), undefined)).toBeNull();
    expect(cellEditCommitValue(cell(undefined, ""), undefined)).toBeNull();
  });

  test("clearing a non-empty value still stores NULL", () => {
    expect(cellEditCommitValue(cell("abc", ""), undefined)).toBeNull();
    expect(cellEditCommitValue(cell(0, ""), undefined)).toBeNull();
  });

  test("uses the provider empty value when one is configured", () => {
    expect(cellEditCommitValue(cell("abc", ""), "")).toBe("");
    expect(cellEditCommitValue(cell(null, ""), "")).toBe("");
    expect(cellEditCommitValue(cell("", ""), "")).toBe("");
  });

  test("passes typed values through", () => {
    expect(cellEditCommitValue(cell("", "x"), undefined)).toBe("x");
    expect(cellEditCommitValue(cell(null, " "), undefined)).toBe(" ");
  });
});

describe("needsMultilineEditor", () => {
  test("routes values with line breaks to the dialog instead of the single-line input", () => {
    expect(needsMultilineEditor("Zeile1\nZeile2")).toBe(true);
    expect(needsMultilineEditor("a\r\nb")).toBe(true);
    expect(needsMultilineEditor("einzeilig")).toBe(false);
    expect(needsMultilineEditor(null)).toBe(false);
    expect(needsMultilineEditor({ a: "x\ny" })).toBe(false);
  });
});

describe("changedRowValues", () => {
  test("keeps only edited columns so untouched JSON and numbers stay typed in the cache", () => {
    const original = { id: 7, meta: { a: 1 }, note: "alt" };
    const updates = buildRowUpdates(["id", "meta", "note"], original, "note", "neu");
    expect(changedRowValues(updates, original)).toEqual({
      updates: { note: "neu" },
      old: { note: "alt" },
    });
  });
});
