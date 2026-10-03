import { describe, expect, test } from "bun:test";
import { cellEditCommitValue } from "../src/features/table/data-table/use-cell-editing";
import { buildRowUpdates, valueToUpdateText } from "../src/lib/cell-editor";

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
