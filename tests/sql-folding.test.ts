import { describe, expect, test } from "bun:test";

import { sqlFoldingRanges } from "../src/lib/sql-folding";

function has(text: string, start: number, end: number) {
  return sqlFoldingRanges(text).some((range) => range.start === start && range.end === end);
}

describe("sql folding", () => {
  test("folds multi-line statements and parentheses", () => {
    const sql = [
      "SELECT id,",
      "  name",
      "FROM t",
      "WHERE id IN (",
      "  1,",
      "  2",
      ");",
      "SELECT 1;",
    ].join("\n");
    expect(has(sql, 1, 7)).toBe(true);
    expect(has(sql, 4, 6)).toBe(true);
    expect(sqlFoldingRanges(sql).some((range) => range.start === 8)).toBe(false);
  });

  test("folds BEGIN/END, IF and LOOP blocks inside dollar bodies", () => {
    const sql = [
      "CREATE FUNCTION f() RETURNS void AS $$",
      "BEGIN",
      "  IF true THEN",
      "    PERFORM 1;",
      "  END IF;",
      "  LOOP",
      "    EXIT;",
      "  END LOOP;",
      "END;",
      "$$ LANGUAGE plpgsql;",
    ].join("\n");
    expect(has(sql, 2, 8)).toBe(true);
    expect(has(sql, 3, 4)).toBe(true);
    expect(has(sql, 6, 7)).toBe(true);
    expect(has(sql, 1, 10)).toBe(true);
  });

  test("ignores transaction BEGIN, IF EXISTS and keywords in strings and comments", () => {
    const sql = [
      "BEGIN;",
      "DROP TABLE IF EXISTS t;",
      "SELECT 'BEGIN (' AS x -- END )",
      "FROM t;",
      "COMMIT;",
    ].join("\n");
    const ranges = sqlFoldingRanges(sql);
    expect(ranges).toEqual([{ start: 3, end: 4, kind: "block" }]);
  });

  test("folds CASE statements, block comments and regions with one fold per start line", () => {
    const sql = [
      "-- region Berichte",
      "/* Kommentar",
      "   zweite Zeile */",
      "SELECT CASE",
      "  WHEN a THEN 1",
      "  ELSE 2",
      "END AS c",
      "FROM t;",
      "-- endregion",
    ].join("\n");
    expect(has(sql, 1, 9)).toBe(true);
    expect(sqlFoldingRanges(sql)).toContainEqual({ start: 2, end: 3, kind: "comment" });
    expect(has(sql, 4, 8)).toBe(true);
    expect(has(sql, 4, 6)).toBe(false);
  });
});
