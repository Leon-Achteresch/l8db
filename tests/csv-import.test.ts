import { describe, expect, test } from "bun:test";

import {
  buildImportPayload,
  detectDelimiter,
  detectHeader,
  isRequiredColumn,
  parseCsv,
  previewCsv,
  stripBom,
  suggestMappings,
  validateMappings,
  type ImportTargetColumn,
} from "../src/lib/csv-import";

const target = (
  name: string,
  overrides: Partial<ImportTargetColumn> = {},
): ImportTargetColumn => ({
  name,
  data_type: "text",
  is_nullable: true,
  has_default: false,
  is_identity: false,
  is_generated: false,
  ...overrides,
});

describe("parseCsv", () => {
  test("liest Header und Zeilen mit Komma", () => {
    const res = parseCsv("id,name\n1,Anna\n2,Bob\n");
    expect(res.delimiter).toBe(",");
    expect(res.hasHeader).toBe(true);
    expect(res.headers).toEqual(["id", "name"]);
    expect(res.rows).toEqual([
      ["1", "Anna"],
      ["2", "Bob"],
    ]);
    expect(res.totalRows).toBe(2);
    expect(res.truncated).toBe(false);
  });

  test("entfernt BOM", () => {
    expect(stripBom("﻿id")).toBe("id");
    const res = parseCsv("﻿id;name\n1;Anna\n");
    expect(res.headers).toEqual(["id", "name"]);
    expect(res.delimiter).toBe(";");
  });

  test("verarbeitet Quotes, Trennzeichen im Feld und doppelte Quotes", () => {
    const res = parseCsv('a,b\n"x,y","er sagte ""hi"""\n');
    expect(res.rows).toEqual([["x,y", 'er sagte "hi"']]);
  });

  test("verarbeitet mehrzeilige Felder", () => {
    const res = parseCsv('a,b\n"Zeile1\nZeile2",2\n');
    expect(res.rows).toEqual([["Zeile1\nZeile2", "2"]]);
    expect(res.totalRows).toBe(1);
  });

  test("unterscheidet NULL und Leerstring", () => {
    const res = parseCsv('a,b,c\n1,,""\n');
    expect(res.rows[0]).toEqual(["1", null, ""]);
  });

  test("emptyField empty liefert Leerstring statt NULL", () => {
    const res = parseCsv("a,b\n1,\n", { emptyField: "empty" });
    expect(res.rows[0]).toEqual(["1", ""]);
  });

  test("erkennt CRLF und TSV", () => {
    const text = "id\tname\r\n1\tAnna\r\n";
    expect(detectDelimiter(text)).toBe("\t");
    const res = parseCsv(text);
    expect(res.rows).toEqual([["1", "Anna"]]);
  });

  test("ohne Header werden Platzhalternamen erzeugt", () => {
    const res = parseCsv("1,2\n3,4\n", { hasHeader: false });
    expect(res.headers).toEqual(["Spalte 1", "Spalte 2"]);
    expect(res.rows.length).toBe(2);
  });

  test("erkennt Kopfzeile nicht bei numerischer erster Zeile", () => {
    expect(detectHeader([["1", "2"]])).toBe(false);
    expect(detectHeader([["id", "name"]])).toBe(true);
    expect(detectHeader([["id", "id"]])).toBe(false);
  });

  test("meldet abweichende Spaltenzahl", () => {
    const res = parseCsv("a,b\n1,2\n3\n");
    expect(res.raggedRows).toEqual([1]);
  });
});

describe("previewCsv", () => {
  test("begrenzt auf 100 Zeilen und meldet unbekannten Gesamtumfang", () => {
    const lines = ["id"].concat(Array.from({ length: 150 }, (_, i) => String(i)));
    const res = previewCsv(lines.join("\n"));
    expect(res.rows.length).toBe(100);
    expect(res.truncated).toBe(true);
    expect(res.totalRows).toBeNull();
  });

  test("kennt den Gesamtumfang bei kleinen Dateien", () => {
    const res = previewCsv("id\n1\n2\n3\n");
    expect(res.totalRows).toBe(3);
    expect(res.truncated).toBe(false);
  });
});

describe("mapping", () => {
  const targets = [
    target("id", { is_nullable: false, is_identity: true, has_default: true }),
    target("first_name", { is_nullable: false }),
    target("email"),
    target("full_name", { is_generated: true }),
  ];

  test("schlägt Zuordnung anhand normalisierter Namen vor", () => {
    const mappings = suggestMappings(["First Name", "E-Mail", "unbekannt"], targets);
    expect(mappings).toEqual([
      { csvIndex: 0, target: "first_name" },
      { csvIndex: 1, target: "email" },
      { csvIndex: 2, target: null },
    ]);
  });

  test("Pflichtspalten sind ohne Default/Identity/Generated", () => {
    expect(isRequiredColumn(targets[1]!)).toBe(true);
    expect(isRequiredColumn(targets[0]!)).toBe(false);
    expect(isRequiredColumn(targets[3]!)).toBe(false);
  });

  test("doppelte Zielzuordnung ist ein Fehler", () => {
    const issues = validateMappings(
      [
        { csvIndex: 0, target: "first_name" },
        { csvIndex: 1, target: "first_name" },
      ],
      targets,
      [["a", "b"]],
    );
    expect(issues.errors.some((e) => e.includes("mehrfach"))).toBe(true);
  });

  test("fehlende Pflichtspalte blockiert", () => {
    const issues = validateMappings([{ csvIndex: 0, target: "email" }], targets, [["a"]]);
    expect(issues.errors.some((e) => e.includes("Pflichtspalte"))).toBe(true);
  });

  test("generierte Spalte darf nicht befüllt werden", () => {
    const issues = validateMappings(
      [
        { csvIndex: 0, target: "first_name" },
        { csvIndex: 1, target: "full_name" },
      ],
      targets,
      [["a", "b"]],
    );
    expect(issues.errors.some((e) => e.includes("Generierte"))).toBe(true);
  });

  test("NULL in NOT NULL-Spalte blockiert mit Zeilennummer", () => {
    const issues = validateMappings([{ csvIndex: 0, target: "first_name" }], targets, [
      ["a"],
      [null],
    ]);
    expect(issues.errors.some((e) => e.includes("Zeile 2"))).toBe(true);
  });

  test("Identity-Zuordnung ist eine Warnung", () => {
    const issues = validateMappings(
      [
        { csvIndex: 0, target: "id" },
        { csvIndex: 1, target: "first_name" },
      ],
      targets,
      [["1", "a"]],
    );
    expect(issues.errors).toEqual([]);
    expect(issues.warnings.some((w) => w.includes("Identity"))).toBe(true);
  });

  test("buildImportPayload lässt nicht zugeordnete Spalten aus", () => {
    const payload = buildImportPayload(
      [
        { csvIndex: 0, target: null },
        { csvIndex: 1, target: "email" },
        { csvIndex: 2, target: "first_name" },
      ],
      [["x", "a@b.de", "Anna"]],
    );
    expect(payload.columns).toEqual(["email", "first_name"]);
    expect(payload.rows).toEqual([["a@b.de", "Anna"]]);
  });
});
