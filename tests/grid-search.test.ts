import { describe, expect, test } from "bun:test";

import {
  describeGridSearch,
  findGridMatches,
  gridCellText,
  gridMatchKey,
  runGridSearch,
  stepMatchIndex,
} from "../src/lib/grid-search";

const rows = [
  { id: 1, name: "Alice", meta: { role: "admin" }, note: null },
  { id: 2, name: "bob", meta: null, note: "ALICE ist Chefin" },
];

describe("gridCellText", () => {
  test("wandelt Werte in durchsuchbaren Text", () => {
    expect(gridCellText(null)).toBe("");
    expect(gridCellText(undefined)).toBe("");
    expect(gridCellText(42)).toBe("42");
    expect(gridCellText({ role: "admin" })).toBe('{"role":"admin"}');
  });
});

describe("findGridMatches", () => {
  test("findet Treffer über Zellen hinweg, unabhängig von Groß-/Kleinschreibung", () => {
    expect(findGridMatches(rows, ["id", "name", "note"], "alice")).toEqual([
      { rowIndex: 0, columnId: "name" },
      { rowIndex: 1, columnId: "note" },
    ]);
  });

  test("berücksichtigt nur die übergebenen sichtbaren Spalten", () => {
    expect(findGridMatches(rows, ["id", "name"], "admin")).toEqual([]);
    expect(findGridMatches(rows, ["meta"], "admin")).toEqual([{ rowIndex: 0, columnId: "meta" }]);
  });

  test("leere Suche liefert keine Treffer", () => {
    expect(findGridMatches(rows, ["name"], "   ")).toEqual([]);
  });
});

describe("stepMatchIndex", () => {
  test("läuft zyklisch vor und zurück", () => {
    expect(stepMatchIndex(0, 3, 1)).toBe(1);
    expect(stepMatchIndex(2, 3, 1)).toBe(0);
    expect(stepMatchIndex(0, 3, -1)).toBe(2);
    expect(stepMatchIndex(5, 3, 1)).toBe(1);
    expect(stepMatchIndex(0, 0, 1)).toBe(0);
  });
});

describe("describeGridSearch", () => {
  test("zeigt Trefferzähler", () => {
    expect(describeGridSearch(0, 0)).toBe("0 Treffer");
    expect(describeGridSearch(3, 1)).toBe("2 von 3");
  });
});

describe("gridMatchKey", () => {
  test("bildet eindeutigen Schlüssel", () => {
    expect(gridMatchKey(2, "name")).toBe("2:name");
  });
});

describe("runGridSearch", () => {
  test("findet Zellen über ein reguläres Muster", () => {
    const result = runGridSearch(rows, ["id", "name", "note"], "^alice$", { regex: true });
    expect(result.error).toBeNull();
    expect(result.matches).toEqual([{ rowIndex: 0, columnId: "name" }]);
  });

  test("meldet ungültige Muster mit Fehlerstelle", () => {
    const result = runGridSearch(rows, ["name"], "ali(", { regex: true });
    expect(result.matches).toEqual([]);
    expect(result.error?.index).toBe(3);
  });

  test("ignoriert Groß-/Kleinschreibung auch im Regex-Modus", () => {
    const result = runGridSearch(rows, ["name", "note"], "alice", { regex: true });
    expect(result.matches).toEqual([
      { rowIndex: 0, columnId: "name" },
      { rowIndex: 1, columnId: "note" },
    ]);
  });

  test("behandelt Metazeichen im Textmodus als Literale", () => {
    expect(runGridSearch(rows, ["name"], "^ali", {}).matches).toEqual([]);
  });
});
