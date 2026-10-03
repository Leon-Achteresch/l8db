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
});
