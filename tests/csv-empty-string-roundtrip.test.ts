import { describe, expect, test } from "bun:test";

const { DEFAULT_CSV_OPTIONS, csvField, serializeCsv } = await import("../src/lib/export");
const { parseCsv } = await import("../src/lib/csv-import/parse");

describe("CSV export keeps empty strings apart from NULL", () => {
  test("empty strings are quoted while NULL stays bare", () => {
    expect(csvField("", DEFAULT_CSV_OPTIONS)).toBe('""');
    expect(csvField(null, DEFAULT_CSV_OPTIONS)).toBe("");
    expect(csvField(undefined, DEFAULT_CSV_OPTIONS)).toBe("");
  });

  test("values equal to a custom NULL text are quoted", () => {
    for (const quote of ['"', "'"]) {
      const options = { ...DEFAULT_CSV_OPTIONS, nullText: "NULL", quote };
      expect(csvField("NULL", options)).toBe(`${quote}NULL${quote}`);
      expect(csvField(null, options)).toBe("NULL");
      expect(csvField("", options)).toBe(`${quote}${quote}`);
    }
  });

  test("default export then import keeps '' and NULL distinct", () => {
    for (const delimiter of [",", ";", "\t", "|"]) {
      const options = { ...DEFAULT_CSV_OPTIONS, delimiter };
      const text = serializeCsv(
        ["id", "a", "b"],
        [
          { id: 1, a: "", b: null },
          { id: 2, a: null, b: "" },
        ],
        options,
      );
      const parsed = parseCsv(text, { delimiter, hasHeader: true });
      expect(parsed.rows).toEqual([
        ["1", "", null],
        ["2", null, ""],
      ]);
    }
  });

  test("single-column export keeps NULL rows, including the last one", () => {
    for (const rows of [
      [{ v: null }, { v: "" }, { v: "x" }],
      [{ v: "x" }, { v: null }],
      [{ v: null }],
    ]) {
      for (const header of [true, false]) {
        const text = serializeCsv(["v"], rows, { ...DEFAULT_CSV_OPTIONS, header });
        const parsed = parseCsv(text, { delimiter: ",", emptyField: "null", hasHeader: header });
        expect(parsed.rows).toEqual(rows.map((row) => [row.v]));
        expect(parsed.totalRows).toBe(rows.length);
      }
    }
    expect(parseCsv('v\n\n""\nx\n', { delimiter: ",", emptyField: "null" }).rows).toEqual([
      [null],
      [""],
      ["x"],
    ]);
  });

  test("blank lines still separate nothing in multi-column files", () => {
    expect(parseCsv("a,b\n1,2\n\n3,4\n", { delimiter: "," }).rows).toEqual([
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  test("characters after a closing quote are reported", () => {
    const parsed = parseCsv('id;name\n1;"ab"c\n2;"ok" \n', { delimiter: ";" });
    expect(parsed.errors).toEqual([
      {
        line: 2,
        column: 7,
        message: "Zeichen nach schließendem Anführungszeichen in Zeile 2, Spalte 7.",
      },
    ]);
  });
});
