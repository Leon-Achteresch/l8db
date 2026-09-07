import { describe, expect, test } from "bun:test";

import {
  classifyNumericCell,
  describeSelectionStats,
  isCellInSelection,
  selectionCellCount,
  selectionRange,
  selectionToTsv,
  serializeSelectionCell,
  summarizeSelection,
} from "../src/lib/grid-selection";

const columns = ["id", "name", "amount", "note"];
const rows = [
  { id: 1, name: "Ada", amount: "10.5", note: "a\tb" },
  { id: 2, name: "Linus", amount: null, note: "zeile1\nzeile2" },
  { id: 3, name: "Grace", amount: "20", note: "text" },
];

describe("selectionRange", () => {
  test("normalisiert Anker und Fokus in sichtbarer Reihenfolge", () => {
    const range = selectionRange(
      { anchor: { rowIndex: 2, columnId: "note" }, focus: { rowIndex: 0, columnId: "name" } },
      columns,
    );
    expect(range).toEqual({ rowStart: 0, rowEnd: 2, columnIds: ["name", "amount", "note"] });
  });

  test("liefert null bei fehlender oder unbekannter Auswahl", () => {
    expect(selectionRange(null, columns)).toBeNull();
    expect(
      selectionRange(
        { anchor: { rowIndex: 0, columnId: "weg" }, focus: { rowIndex: 0, columnId: "id" } },
        columns,
      ),
    ).toBeNull();
  });

  test("zählt Zellen und prüft Zugehörigkeit", () => {
    const range = selectionRange(
      { anchor: { rowIndex: 0, columnId: "id" }, focus: { rowIndex: 1, columnId: "name" } },
      columns,
    );
    expect(selectionCellCount(range)).toBe(4);
    expect(selectionCellCount(null)).toBe(0);
    expect(isCellInSelection(range, 1, "name")).toBe(true);
    expect(isCellInSelection(range, 2, "name")).toBe(false);
    expect(isCellInSelection(range, 0, "amount")).toBe(false);
  });
});

describe("selectionToTsv", () => {
  test("serialisiert NULL als leeres Feld und ersetzt Tabs und Umbrüche", () => {
    expect(serializeSelectionCell(null)).toBe("");
    expect(serializeSelectionCell(undefined)).toBe("");
    expect(serializeSelectionCell("a\tb")).toBe("a b");
    expect(serializeSelectionCell("a\r\nb")).toBe("a b");
    expect(serializeSelectionCell({ a: 1 })).toBe('{"a":1}');
  });

  test("folgt der sichtbaren Spalten- und Zeilenreihenfolge", () => {
    const range = selectionRange(
      { anchor: { rowIndex: 0, columnId: "name" }, focus: { rowIndex: 1, columnId: "note" } },
      columns,
    );
    expect(selectionToTsv(rows, range)).toBe("Ada\t10.5\ta b\nLinus\t\tzeile1 zeile2");
  });

  test("kann Kopfzeile voranstellen und liefert ohne Auswahl leeren Text", () => {
    const range = selectionRange(
      { anchor: { rowIndex: 2, columnId: "id" }, focus: { rowIndex: 2, columnId: "name" } },
      columns,
    );
    expect(selectionToTsv(rows, range, { includeHeader: true })).toBe("id\tname\n3\tGrace");
    expect(selectionToTsv(rows, null)).toBe("");
  });
});

describe("classifyNumericCell", () => {
  test("erkennt Zahlen, Text und NULL", () => {
    expect(classifyNumericCell(null)).toEqual({ kind: "null" });
    expect(classifyNumericCell(undefined)).toEqual({ kind: "null" });
    expect(classifyNumericCell(4)).toEqual({ kind: "number", value: 4 });
    expect(classifyNumericCell("-2.5")).toEqual({ kind: "number", value: -2.5 });
    expect(classifyNumericCell("1e3")).toEqual({ kind: "number", value: 1000 });
    expect(classifyNumericCell("abc")).toEqual({ kind: "text" });
    expect(classifyNumericCell("")).toEqual({ kind: "text" });
    expect(classifyNumericCell(true)).toEqual({ kind: "text" });
  });

  test("weist präzisionskritische Werte als nicht unterstützt aus", () => {
    expect(classifyNumericCell("123456789012345678901")).toEqual({ kind: "unsupported" });
    expect(classifyNumericCell("0.12345678901234567")).toEqual({ kind: "unsupported" });
    expect(classifyNumericCell(Number.NaN)).toEqual({ kind: "unsupported" });
    expect(classifyNumericCell(10n ** 30n)).toEqual({ kind: "unsupported" });
    expect(classifyNumericCell(42n)).toEqual({ kind: "number", value: 42 });
  });
});

describe("summarizeSelection", () => {
  test("ignoriert NULL und Text bei den Kennzahlen", () => {
    const range = selectionRange(
      { anchor: { rowIndex: 0, columnId: "amount" }, focus: { rowIndex: 2, columnId: "note" } },
      columns,
    );
    const stats = summarizeSelection(rows, range);
    expect(stats).not.toBeNull();
    expect(stats?.cellCount).toBe(6);
    expect(stats?.nullCount).toBe(1);
    expect(stats?.textCount).toBe(3);
    expect(stats?.numericCount).toBe(2);
    expect(stats?.sum).toBe(30.5);
    expect(stats?.min).toBe(10.5);
    expect(stats?.max).toBe(20);
    expect(stats?.average).toBe(15.25);
  });

  test("liefert keine Zahlenkennzahlen ohne numerische Werte", () => {
    const range = selectionRange(
      { anchor: { rowIndex: 0, columnId: "name" }, focus: { rowIndex: 1, columnId: "name" } },
      columns,
    );
    const stats = summarizeSelection(rows, range);
    expect(stats?.numericCount).toBe(0);
    expect(stats?.sum).toBeNull();
    expect(stats?.average).toBeNull();
    expect(stats?.min).toBeNull();
    expect(stats?.max).toBeNull();
  });

  test("liefert null ohne Auswahl", () => {
    expect(summarizeSelection(rows, null)).toBeNull();
    expect(describeSelectionStats(null)).toBe("");
  });
});

describe("describeSelectionStats", () => {
  test("nennt Anzahl, Summe und Mittelwert", () => {
    const range = selectionRange(
      { anchor: { rowIndex: 0, columnId: "amount" }, focus: { rowIndex: 2, columnId: "amount" } },
      columns,
    );
    const text = describeSelectionStats(summarizeSelection(rows, range));
    expect(text).toContain("3 Zellen");
    expect(text).toContain("1 NULL");
    expect(text).toContain("Σ 30.5");
    expect(text).toContain("Ø 15.25");
    expect(text).toContain("Min 10.5");
    expect(text).toContain("Max 20");
  });

  test("weist nicht berechenbare Werte aus", () => {
    const oddRows = [{ v: "123456789012345678901" }];
    const range = selectionRange(
      { anchor: { rowIndex: 0, columnId: "v" }, focus: { rowIndex: 0, columnId: "v" } },
      ["v"],
    );
    expect(describeSelectionStats(summarizeSelection(oddRows, range))).toContain(
      "1 nicht berechenbar",
    );
  });
});
