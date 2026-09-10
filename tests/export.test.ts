import { describe, expect, test } from "bun:test";

import {
  DEFAULT_CSV_OPTIONS,
  type ColumnMask,
  applyMasks,
  maskedValue,
  UnsupportedValueError,
  buildInsertStatements,
  csvField,
  csvOptionsError,
  csvPreview,
  identifierStyleForKind,
  parseCsv,
  quoteIdentifier,
  serializeCsv,
  sqlLiteral,
} from "../src/lib/export";

const columns = ["id", "name", "note"];
const rows: Record<string, unknown>[] = [
  { id: 1, name: "Anna", note: null },
  { id: 2, name: 'Say "hi"', note: "a,b" },
  { id: 3, name: "multi\nline", note: "  padded  " },
];

describe("csv", () => {
  test("Kopfzeile ist abschaltbar", () => {
    const withHeader = serializeCsv(columns, rows, DEFAULT_CSV_OPTIONS);
    const without = serializeCsv(columns, rows, { ...DEFAULT_CSV_OPTIONS, header: false });
    expect(withHeader.split("\n")[0]).toBe("id,name,note");
    expect(without.startsWith("id,name")).toBe(false);
  });

  test("NULL-Darstellung wird übernommen", () => {
    const out = serializeCsv(columns, [rows[0]], {
      ...DEFAULT_CSV_OPTIONS,
      header: false,
      nullText: "\\N",
    });
    expect(out).toBe("1,Anna,\\N");
  });

  test("Trennzeichen, Zeilenende und BOM sind konfigurierbar", () => {
    const out = serializeCsv(columns, [rows[0]], {
      ...DEFAULT_CSV_OPTIONS,
      delimiter: ";",
      lineEnding: "\r\n",
      bom: true,
    });
    expect(out.startsWith("﻿")).toBe(true);
    expect(out).toContain("\r\n");
    expect(out).toContain("id;name;note");
  });

  test("Roundtrip mit Quotes, Trennzeichen und mehrzeiligen Werten", () => {
    for (const options of [
      DEFAULT_CSV_OPTIONS,
      { ...DEFAULT_CSV_OPTIONS, delimiter: ";", lineEnding: "\r\n" as const },
      { ...DEFAULT_CSV_OPTIONS, delimiter: "\t", quote: "'", bom: true },
    ]) {
      const text = serializeCsv(columns, rows, options);
      const parsed = parseCsv(text, options);
      expect(parsed[0]).toEqual(columns);
      expect(parsed.length).toBe(rows.length + 1);
      expect(parsed[1]).toEqual(["1", "Anna", ""]);
      expect(parsed[2]).toEqual(["2", 'Say "hi"', "a,b"]);
      expect(parsed[3]).toEqual(["3", "multi\nline", "  padded  "]);
    }
  });

  test("Vorschau nutzt denselben Serializer und begrenzt Zeilen", () => {
    const preview = csvPreview(columns, rows, DEFAULT_CSV_OPTIONS, 2);
    const full = serializeCsv(columns, rows.slice(0, 2), DEFAULT_CSV_OPTIONS);
    expect(preview).toBe(full);
    expect(preview.split("\n").length).toBe(3);
  });

  test("Vorschau enthält kein BOM", () => {
    const preview = csvPreview(columns, rows, { ...DEFAULT_CSV_OPTIONS, bom: true });
    expect(preview.startsWith("﻿")).toBe(false);
  });

  test("Objekte werden als JSON serialisiert", () => {
    expect(csvField({ a: 1 }, DEFAULT_CSV_OPTIONS)).toBe('"{""a"":1}"');
  });

  test("ungültige Optionen werden gemeldet", () => {
    expect(csvOptionsError(DEFAULT_CSV_OPTIONS)).toBeNull();
    expect(csvOptionsError({ ...DEFAULT_CSV_OPTIONS, delimiter: '"' })).not.toBeNull();
    expect(csvOptionsError({ ...DEFAULT_CSV_OPTIONS, delimiter: ",," })).not.toBeNull();
  });
});

describe("insert-export", () => {
  test("Ziel und Spalten werden gequotet", () => {
    const sql = buildInsertStatements({
      schema: "public",
      table: 'we"ird',
      columns: ["id", "na me"],
      rows: [{ id: 1, "na me": "x" }],
      kind: "postgres",
    });
    expect(sql).toBe('INSERT INTO "public"."we""ird" ("id", "na me") VALUES (1, \'x\');\n');
  });

  test("Quoting folgt dem Datenbank-Kind", () => {
    expect(identifierStyleForKind("mysql")).toBe("backtick");
    expect(identifierStyleForKind("mssql")).toBe("bracket");
    expect(identifierStyleForKind("oracle")).toBe("double");
    expect(quoteIdentifier("a`b", "backtick")).toBe("`a``b`");
    expect(quoteIdentifier("a]b", "bracket")).toBe("[a]]b]");
  });

  test("NULL, Zahlen, Strings, Bool und JSON werden literalisiert", () => {
    expect(sqlLiteral(null, "c")).toBe("NULL");
    expect(sqlLiteral(undefined, "c")).toBe("NULL");
    expect(sqlLiteral(42, "c")).toBe("42");
    expect(sqlLiteral(-1.5, "c")).toBe("-1.5");
    expect(sqlLiteral(true, "c")).toBe("TRUE");
    expect(sqlLiteral("O'Brien", "c")).toBe("'O''Brien'");
    expect(sqlLiteral({ a: [1, null] }, "c")).toBe("'{\"a\":[1,null]}'");
    expect(sqlLiteral(new Date("2024-01-02T03:04:05.000Z"), "c")).toBe("'2024-01-02T03:04:05.000Z'");
  });

  test("unbekannte Typen verhindern den Export", () => {
    expect(() => sqlLiteral(Number.NaN, "amount")).toThrow(UnsupportedValueError);
    expect(() => sqlLiteral(new Uint8Array([1]), "blob")).toThrow(UnsupportedValueError);
    expect(() =>
      buildInsertStatements({
        table: "t",
        columns: ["a"],
        rows: [{ a: () => 1 }],
        kind: "postgres",
      }),
    ).toThrow(/Spalte "a"/);
  });

  test("__ctid__ wird ausgelassen und nur geladene Zeilen exportiert", () => {
    const sql = buildInsertStatements({
      table: "t",
      columns: ["__ctid__", "a"],
      rows: [{ __ctid__: "(0,1)", a: 1 }, { a: 2 }],
    });
    expect(sql).not.toContain("__ctid__");
    expect(sql.trimEnd().split("\n").length).toBe(2);
    expect(sql).toContain('INSERT INTO "t" ("a") VALUES (2);');
  });

  test("leere Zeilenmenge erzeugt leeren Inhalt", () => {
    expect(buildInsertStatements({ table: "t", columns: ["a"], rows: [] })).toBe("");
  });
});

describe("Spaltenmaskierung", () => {
  const columns = ["id", "email", "token"];
  const rows = [
    { id: 1, email: "a@b.de", token: "secret" },
    { id: 2, email: "c@d.de", token: null },
  ];
  const masks: ColumnMask[] = [
    { column: "email", mode: "text", text: "***" },
    { column: "token", mode: "null" },
  ];

  test("maskedValue ersetzt nur gewählte Spalten", () => {
    expect(maskedValue("id", 1, masks)).toBe(1);
    expect(maskedValue("email", "a@b.de", masks)).toBe("***");
    expect(maskedValue("token", "secret", masks)).toBeNull();
  });

  test("fester Text ohne Angabe ist leer", () => {
    expect(maskedValue("a", "x", [{ column: "a", mode: "text" }])).toBe("");
  });

  test("applyMasks lässt Originalzeilen unverändert", () => {
    const masked = applyMasks(columns, rows, masks);
    expect(rows[0].email).toBe("a@b.de");
    expect(masked[0].email).toBe("***");
    expect(masked[0].token).toBeNull();
    expect(masked[0].id).toBe(1);
  });

  test("ohne Masken bleibt die Referenz erhalten", () => {
    expect(applyMasks(columns, rows, [])).toBe(rows);
  });

  test("Vorschau und Datei zeigen identisch maskierte Werte", () => {
    const options = { ...DEFAULT_CSV_OPTIONS, nullText: "NULL" };
    const masked = applyMasks(columns, rows, masks);
    const file = serializeCsv(columns, masked, options);
    const preview = csvPreview(columns, masked, options, 5);
    expect(preview).toBe(file);
    expect(file).not.toContain("a@b.de");
    expect(file).not.toContain("secret");
    expect(file.split("\n")[1]).toBe("1,***,NULL");
  });
});
