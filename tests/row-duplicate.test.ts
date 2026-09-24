import { describe, expect, test } from "bun:test";

import {
  buildDuplicatePrefill,
  describeInsertError,
  planPasteSpread,
} from "../src/lib/row-duplicate";

const columns = ["__ctid__", "id", "name", "note", "created_at", "full_name"];

const details = [
  { name: "id", is_primary_key: true, column_default: "nextval('t_id_seq'::regclass)" },
  { name: "name", is_primary_key: false, column_default: null },
  { name: "note", is_primary_key: false, column_default: null },
  { name: "created_at", is_primary_key: false, column_default: "now()" },
  {
    name: "full_name",
    is_primary_key: false,
    column_default: "GENERATED ALWAYS AS (name) STORED",
  },
];

const row = {
  __ctid__: "(0,1)",
  id: "42",
  name: "Ada",
  note: null,
  created_at: "2024-01-01",
  full_name: "Ada",
};

describe("buildDuplicatePrefill", () => {
  test("übernimmt Werte und lässt ctid sowie generierte Spalten aus", () => {
    const prefill = buildDuplicatePrefill(columns, row, details);
    expect(Object.keys(prefill).sort()).toEqual(["created_at", "id", "name", "note"]);
    expect(prefill.name).toEqual({
      mode: "value",
      value: "Ada",
      isPrimaryKey: false,
      cleared: false,
    });
  });

  test("leert Serial-/Identity-/Default-Spalten", () => {
    const prefill = buildDuplicatePrefill(columns, row, details);
    expect(prefill.id).toEqual({ mode: "default", value: "", isPrimaryKey: true, cleared: true });
    expect(prefill.created_at.cleared).toBe(true);
    expect(prefill.created_at.mode).toBe("default");
  });

  test("markiert Primärschlüsselspalten ohne Default und behält deren Wert", () => {
    const prefill = buildDuplicatePrefill(["code", "label"], { code: "AB", label: "x" }, [
      { name: "code", is_primary_key: true, column_default: null },
      { name: "label", is_primary_key: false, column_default: null },
    ]);
    expect(prefill.code).toEqual({
      mode: "value",
      value: "AB",
      isPrimaryKey: true,
      cleared: false,
    });
    expect(prefill.label.isPrimaryKey).toBe(false);
  });

  test("bildet NULL-Werte auf den NULL-Modus ab", () => {
    const prefill = buildDuplicatePrefill(columns, row, details);
    expect(prefill.note).toEqual({
      mode: "null",
      value: "",
      isPrimaryKey: false,
      cleared: false,
    });
  });

  test("überspringt explizit generierte Spalten und wandelt Nicht-Strings", () => {
    const prefill = buildDuplicatePrefill(["amount", "calc"], { amount: 5, calc: 10 }, [
      { name: "amount", is_primary_key: false, column_default: null },
      { name: "calc", is_primary_key: false, column_default: null, is_generated: true },
    ]);
    expect(prefill.calc).toBeUndefined();
    expect(prefill.amount.value).toBe("5");
  });

  test("erhält JSON-Objekte und Arrays als bearbeitbare JSON-Werte", () => {
    const prefill = buildDuplicatePrefill(["payload", "tags"], {
      payload: { enabled: true, count: 2 },
      tags: ["a", "b"],
    });
    expect(JSON.parse(prefill.payload.value)).toEqual({ enabled: true, count: 2 });
    expect(JSON.parse(prefill.tags.value)).toEqual(["a", "b"]);
  });

  test("funktioniert ohne Spaltenmetadaten", () => {
    const prefill = buildDuplicatePrefill(["a"], { a: "1" });
    expect(prefill.a).toEqual({ mode: "value", value: "1", isPrimaryKey: false, cleared: false });
  });

  test("leert Identity-Spalten ohne Default", () => {
    const prefill = buildDuplicatePrefill(["id"], { id: "7" }, [
      { name: "id", is_primary_key: true, is_identity: true, column_default: null },
    ]);
    expect(prefill.id.cleared).toBe(true);
  });
});

describe("describeInsertError", () => {
  test("erklärt Unique-Verletzungen", () => {
    const message = describeInsertError('duplicate key value violates unique constraint "t_pkey"');
    expect(message).toContain("Konflikt");
    expect(message).toContain("t_pkey");
  });

  test("erkennt SQLite- und MySQL-Konflikte", () => {
    expect(describeInsertError("UNIQUE constraint failed: t.id")).toContain("Konflikt");
    expect(describeInsertError(new Error("Duplicate entry '1' for key 'PRIMARY'"))).toContain(
      "Konflikt",
    );
  });

  test("gibt andere Fehler unverändert zurück", () => {
    expect(describeInsertError("connection lost")).toBe("connection lost");
  });
});

describe("planPasteSpread", () => {
  const columns = ["id", "name", "note", "created_at"];

  test("verteilt tab-getrennte Werte ab der Startspalte", () => {
    const plan = planPasteSpread("Ada\thallo", columns, "name");
    expect(plan.assignments).toEqual([
      { column: "name", mode: "value", value: "Ada" },
      { column: "note", mode: "value", value: "hallo" },
    ]);
    expect(plan.droppedRows).toBe(0);
    expect(plan.droppedCells).toBe(0);
  });

  test("übernimmt bei mehreren Zeilen nur die erste und zählt den Rest", () => {
    const plan = planPasteSpread("Ada\tx\nBob\ty\nCid\tz", columns, "id");
    expect(plan.assignments).toEqual([
      { column: "id", mode: "value", value: "Ada" },
      { column: "name", mode: "value", value: "x" },
    ]);
    expect(plan.droppedRows).toBe(2);
  });

  test("kürzt Werte ab, die nicht mehr in die verbleibenden Spalten passen", () => {
    const plan = planPasteSpread("a\tb\tc\td\te", ["id", "name"], "id");
    expect(plan.assignments).toEqual([
      { column: "id", mode: "value", value: "a" },
      { column: "name", mode: "value", value: "b" },
    ]);
    expect(plan.droppedCells).toBe(3);
  });

  test("bildet leere Zellen auf den Standard-Modus ab", () => {
    const plan = planPasteSpread("Ada\t\thallo", columns, "name");
    expect(plan.assignments).toEqual([
      { column: "name", mode: "value", value: "Ada" },
      { column: "note", mode: "default", value: "" },
      { column: "created_at", mode: "value", value: "hallo" },
    ]);
  });

  test("übernimmt leere Zellen am Ende als Standard-Modus", () => {
    const plan = planPasteSpread("Ada\tx\t\t", columns, "id");
    expect(plan.assignments).toEqual([
      { column: "id", mode: "value", value: "Ada" },
      { column: "name", mode: "value", value: "x" },
      { column: "note", mode: "default", value: "" },
      { column: "created_at", mode: "default", value: "" },
    ]);
    expect(plan.droppedCells).toBe(0);
  });

  test("behandelt CRLF- und CR-Zeilenumbrüche", () => {
    const crlf = planPasteSpread("a\tb\r\nc\td", columns, "id");
    expect(crlf.assignments).toEqual([
      { column: "id", mode: "value", value: "a" },
      { column: "name", mode: "value", value: "b" },
    ]);
    expect(crlf.droppedRows).toBe(1);
    const cr = planPasteSpread("a\tb\rc\td", columns, "id");
    expect(cr.droppedRows).toBe(1);
  });

  test("ignoriert eine abschließende Leerzeile", () => {
    const plan = planPasteSpread("Ada\tx\n", columns, "id");
    expect(plan.droppedRows).toBe(0);
    expect(plan.assignments).toHaveLength(2);
  });

  test("liefert für einen einzelnen Wert genau eine Zuweisung", () => {
    const plan = planPasteSpread("Ada", columns, "name");
    expect(plan.assignments).toEqual([{ column: "name", mode: "value", value: "Ada" }]);
    expect(plan.droppedRows).toBe(0);
    expect(plan.droppedCells).toBe(0);
  });
});
