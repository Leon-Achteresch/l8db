import { describe, expect, test } from "bun:test";

import { buildDuplicatePrefill, describeInsertError } from "../src/lib/row-duplicate";

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
    const prefill = buildDuplicatePrefill(
      ["code", "label"],
      { code: "AB", label: "x" },
      [
        { name: "code", is_primary_key: true, column_default: null },
        { name: "label", is_primary_key: false, column_default: null },
      ],
    );
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
    const prefill = buildDuplicatePrefill(
      ["amount", "calc"],
      { amount: 5, calc: 10 },
      [
        { name: "amount", is_primary_key: false, column_default: null },
        { name: "calc", is_primary_key: false, column_default: null, is_generated: true },
      ],
    );
    expect(prefill.calc).toBeUndefined();
    expect(prefill.amount.value).toBe("5");
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
    const message = describeInsertError(
      'duplicate key value violates unique constraint "t_pkey"',
    );
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
