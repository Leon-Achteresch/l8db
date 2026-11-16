import { describe, expect, mock, test } from "bun:test";
import {
  buildRowUpdates,
  cellDraftToUpdate,
  changedRowValues,
  detectCellEditorKind,
  formatJsonDraft,
  toCellDraft,
  validateCellDraft,
} from "../src/lib/cell-editor";
import fixtures from "./fixtures/postgres-array.json";

const calls: { command: string; args: Record<string, unknown> }[] = [];
mock.module("@tauri-apps/api/core", () => ({
  invoke: async (command: string, args: Record<string, unknown>) => {
    calls.push({ command, args });
    return "(0,1)@1@2";
  },
}));
const { updateRow } = await import("../src/lib/db/rows");
const { updateRowInTransaction } = await import("../src/lib/db/transactions");

describe("PostgreSQL arrays through the existing cell editor contract", () => {
  for (const fixture of fixtures.cases) {
    test(fixture.name, async () => {
      const kind = detectCellEditorKind(fixture.row_value, fixture.data_type);
      expect(kind).toBe("text");
      const draft = toCellDraft(fixture.row_value, kind);
      expect(draft.isNull).toBe(false);
      expect(validateCellDraft(draft, kind).ok).toBe(true);
      expect(cellDraftToUpdate(draft)).toBe(
        typeof fixture.row_value === "string" ? fixture.row_value : formatJsonDraft(fixture.input),
      );
      const updates = buildRowUpdates(["id", "items"], { id: 1, items: [] }, "items", draft.text);
      expect(updates.items).toBe(draft.text);
      expect(updates.id).toBe("1");
      const changed = changedRowValues(updates, { id: 1, items: null }).updates;
      calls.length = 0;
      await updateRow(
        "postgres",
        "postgresql://fixture.invalid/example",
        "public",
        "t",
        "(0,1)@1@2",
        changed,
      );
      await updateRowInTransaction("fixture-tx", "public", "t", "(0,1)@1@2", changed);
      expect(calls.map((call) => call.command)).toEqual([
        "update_row",
        "update_row_in_transaction",
      ]);
      for (const call of calls) expect(call.args.updates).toEqual({ items: draft.text });
    });
  }

  test("SQL NULL toggle, empty array and null elements remain different payloads", () => {
    expect(cellDraftToUpdate(toCellDraft(null, "json"))).toBeNull();
    expect(cellDraftToUpdate(toCellDraft([], "json"))).toBe("[]");
    expect(cellDraftToUpdate(toCellDraft([null], "json"))).toBe("[\n  null\n]");
    expect(changedRowValues({ items: "[]" }, { items: null }).updates).toEqual({ items: "[]" });
    expect(changedRowValues({ items: null }, { items: [] }).updates).toEqual({ items: null });
  });

  test("unrelated edits do not send untouched JSON arrays or unsupported composite arrays", () => {
    const original = { id: 1, items: ["a", null], structured: [{ a: 1 }] };
    const updates = buildRowUpdates(Object.keys(original), original, "id", "2");
    expect(changedRowValues(updates, original).updates).toEqual({ id: "2" });
  });

  test("array types use existing text editing while JSON columns retain the JSON editor", () => {
    expect(detectCellEditorKind([1, 2], "bigint[]")).toBe("text");
    expect(detectCellEditorKind([{ a: 1 }], "jsonb[]")).toBe("text");
    expect(detectCellEditorKind(null, "numeric(20,4)[] ")).toBe("text");
    expect(detectCellEditorKind([1, 2], "jsonb")).toBe("json");
    expect(detectCellEditorKind([1, 2])).toBe("json");
    const raw = '[900719925474099312345,12.500,-0,"a\\\\b",null]';
    const draft = toCellDraft(raw, detectCellEditorKind(raw, "numeric[]"));
    expect(cellDraftToUpdate(draft)).toBe(raw);
  });
});
