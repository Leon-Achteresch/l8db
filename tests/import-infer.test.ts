import { describe, expect, test } from "bun:test";

import { inferColumnTypes, typeMismatch } from "../src/lib/csv-import";
import { detectImportFormat } from "../src/lib/import-file";

describe("import type inference", () => {
  test("widens and preserves leading zeros", () => {
    const rows = [
      ["1", "1.5", "2024-01-02", "007", "true", '{"a":1}', null],
      ["2", "3", "2024-01-02 10:00:00", "12", "no", "[1]", ""],
    ];
    expect(inferColumnTypes(7, rows)).toEqual([
      "integer",
      "decimal",
      "timestamp",
      "text",
      "boolean",
      "json",
      "empty",
    ]);
  });

  test("flags incompatible target types", () => {
    expect(typeMismatch("text", "integer")).toBe(true);
    expect(typeMismatch("integer", "bigint")).toBe(false);
    expect(typeMismatch("timestamp", "int")).toBe(true);
    expect(typeMismatch("json", "jsonb")).toBe(false);
  });

  test("detects file format by extension", () => {
    expect(detectImportFormat("/a/b.XLSX")).toBe("xlsx");
    expect(detectImportFormat("x.ndjson")).toBe("ndjson");
    expect(detectImportFormat("x.json")).toBe("json");
    expect(detectImportFormat("x.parquet")).toBe("parquet");
    expect(detectImportFormat("x.tsv")).toBe("csv");
  });
});
