import { describe, expect, test } from "bun:test";

import {
  buildRowUpdates,
  cellDraftToUpdate,
  describeCellDraft,
  detectCellEditorKind,
  formatJsonDraft,
  isCellDraftDirty,
  isLargeCellValue,
  toCellDraft,
  validateCellDraft,
  valueToUpdateText,
} from "../src/lib/cell-editor";

describe("detectCellEditorKind", () => {
  test("erkennt json über den Spaltentyp", () => {
    expect(detectCellEditorKind("beliebig", "jsonb")).toBe("json");
    expect(detectCellEditorKind("beliebig", "text")).toBe("text");
  });

  test("erkennt json über Objektwerte und JSON-Strings", () => {
    expect(detectCellEditorKind({ a: 1 })).toBe("json");
    expect(detectCellEditorKind('{"a":1}')).toBe("json");
    expect(detectCellEditorKind("{kein json}")).toBe("text");
  });
});

describe("toCellDraft", () => {
  test("unterscheidet NULL und leeren String", () => {
    expect(toCellDraft(null)).toEqual({ text: "", isNull: true });
    expect(toCellDraft(undefined)).toEqual({ text: "", isNull: true });
    expect(toCellDraft("")).toEqual({ text: "", isNull: false });
  });

  test("formatiert JSON-Entwürfe lesbar", () => {
    expect(toCellDraft('{"a":1}', "json").text).toBe('{\n  "a": 1\n}');
    expect(toCellDraft('{"a":1}', "text").text).toBe('{"a":1}');
  });
});

describe("validateCellDraft", () => {
  test("akzeptiert NULL und beliebigen Text", () => {
    expect(validateCellDraft({ text: "", isNull: true }, "json").ok).toBe(true);
    expect(validateCellDraft({ text: "kein json", isNull: false }, "text").ok).toBe(true);
  });

  test("lehnt ungültiges JSON ab", () => {
    const result = validateCellDraft({ text: "{", isNull: false }, "json");
    expect(result.ok).toBe(false);
  });

  test("lehnt leeren JSON-Text ab", () => {
    expect(validateCellDraft({ text: "   ", isNull: false }, "json").ok).toBe(false);
  });

  test("akzeptiert gültiges JSON", () => {
    expect(validateCellDraft({ text: '{"a": [1,2]}', isNull: false }, "json").ok).toBe(true);
  });
});

describe("formatJsonDraft", () => {
  test("formatiert gültiges JSON und meldet ungültiges", () => {
    expect(formatJsonDraft('{"a":1}')).toBe('{\n  "a": 1\n}');
    expect(formatJsonDraft("{")).toBeNull();
  });
});

describe("cellDraftToUpdate", () => {
  test("liefert null für NULL und leeren String für Leertext", () => {
    expect(cellDraftToUpdate({ text: "x", isNull: true })).toBeNull();
    expect(cellDraftToUpdate({ text: "", isNull: false })).toBe("");
  });
});

describe("isCellDraftDirty", () => {
  test("erkennt unveränderte Werte", () => {
    expect(isCellDraftDirty("abc", { text: "abc", isNull: false })).toBe(false);
    expect(isCellDraftDirty(null, { text: "", isNull: true })).toBe(false);
  });

  test("unterscheidet NULL von leerem String", () => {
    expect(isCellDraftDirty(null, { text: "", isNull: false })).toBe(true);
    expect(isCellDraftDirty("", { text: "", isNull: true })).toBe(true);
  });

  test("vergleicht JSON semantisch", () => {
    expect(isCellDraftDirty({ a: 1 }, { text: '{\n  "a": 1\n}', isNull: false }, "json")).toBe(
      false,
    );
    expect(isCellDraftDirty({ a: 1 }, { text: '{"a": 2}', isNull: false }, "json")).toBe(true);
  });
});

describe("isLargeCellValue", () => {
  test("erkennt lange Texte, Zeilenumbrüche und Objekte", () => {
    expect(isLargeCellValue(null)).toBe(false);
    expect(isLargeCellValue("kurz")).toBe(false);
    expect(isLargeCellValue("a\nb")).toBe(true);
    expect(isLargeCellValue("x".repeat(51))).toBe(true);
    expect(isLargeCellValue({ a: 1 })).toBe(true);
  });
});

describe("describeCellDraft", () => {
  test("beschreibt NULL, leeren Text und Inhalte", () => {
    expect(describeCellDraft({ text: "", isNull: true })).toBe("NULL");
    expect(describeCellDraft({ text: "", isNull: false })).toBe("Leerer Text");
    expect(describeCellDraft({ text: "ab\ncd", isNull: false })).toBe("5 Zeichen · 2 Zeilen");
  });
});

describe("buildRowUpdates", () => {
  test("übernimmt unveränderte Spalten und setzt den neuen Wert", () => {
    const updates = buildRowUpdates(
      ["id", "note", "payload"],
      { id: 7, note: null, payload: { a: 1 } },
      "note",
      "neu",
    );
    expect(updates).toEqual({ id: "7", note: "neu", payload: '{"a":1}' });
  });

  test("schreibt NULL für den Zielwert", () => {
    expect(buildRowUpdates(["a"], { a: "x" }, "a", null)).toEqual({ a: null });
  });
});

describe("valueToUpdateText", () => {
  test("bildet null und Objekte ab", () => {
    expect(valueToUpdateText(null)).toBeNull();
    expect(valueToUpdateText({ a: 1 })).toBe('{"a":1}');
    expect(valueToUpdateText(5)).toBe("5");
  });
});
