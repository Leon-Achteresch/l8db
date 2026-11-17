import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { compileSingleCondition, parseFilterList } from "../src/lib/sql-filter";
import {
  looksLikeSqlFilterList,
  MAX_SQL_LIST_CHARACTERS,
  MAX_SQL_LIST_VALUES,
  parseSqlFilterList,
  prepareSqlFilterListImport,
} from "../src/lib/sql-filter-list-import";

describe("bounded SQL literal lists", () => {
  test("standard quoted literals preserve punctuation, whitespace, Unicode and doubled quotes", () => {
    expect(
      parseSqlFilterList(
        " ( 'A', 'a,b', 'a;b', 'O''Brien', N'東京', ' x ', 'NULL', 'line\nnext' ) \n",
      ),
    ).toEqual({
      ok: true,
      values: ["A", "a,b", "a;b", "O'Brien", "東京", " x ", "NULL", "line\nnext"],
    });
    expect(parseSqlFilterList("('''')")).toEqual({ ok: true, values: ["'"] });
  });

  test("numeric lexemes stay text without JavaScript rounding and booleans use existing filter values", () => {
    expect(
      parseSqlFilterList("(900719925474099312345, -12.500, +7, 1e-30, TRUE, false, '001')"),
    ).toEqual({
      ok: true,
      values: ["900719925474099312345", "-12.500", "+7", "1e-30", "true", "false", "001"],
    });
  });

  test("ambiguous, unsupported, empty and executable syntax is rejected as a whole", () => {
    for (const source of [
      "",
      "()",
      "('')",
      "('  ')",
      "(NULL)",
      "(null, 'x')",
      "('x',)",
      "('x' 'y')",
      "('x'",
      "('x') trailing",
      "('x'); SELECT 1",
      "(SELECT id FROM t)",
      "(1+2)",
      "((1,2))",
      "(1 /* comment */)",
      "(true--comment\n)",
      "(DATE '2026-11-17')",
      "(X'ff')",
      "(E'\\n')",
      "('a\\b')",
      "('a\0b')",
      "'a', 'b'",
    ]) {
      const parsed = parseSqlFilterList(source);
      expect(parsed.ok).toBe(false);
      if (parsed.ok) throw Error(source);
      expect(parsed.error.length).toBeGreaterThan(5);
    }
    expect(looksLikeSqlFilterList("('a', 'b')")).toBe(true);
    expect(looksLikeSqlFilterList("(NULL)")).toBe(true);
    expect(looksLikeSqlFilterList("a;b\nc")).toBe(false);
    expect(looksLikeSqlFilterList("single")).toBe(false);
  });

  test("merge preserves the established JSON list format, order and existing values", () => {
    const merged = prepareSqlFilterListImport("('a', 'b', 'a', 'a,b')", '["existing","a"]');
    expect(merged).toEqual({
      ok: true,
      values: ["a", "b", "a,b"],
      encoded: '["existing","a","b","a,b"]',
      added: 2,
      total: 4,
    });
    expect(prepareSqlFilterListImport("('a')", "not JSON")).toMatchObject({
      ok: true,
      encoded: '["not JSON","a"]',
    });
    expect(prepareSqlFilterListImport("('a')", '["a"]')).toMatchObject({
      ok: true,
      added: 0,
      total: 1,
    });
    expect(prepareSqlFilterListImport("('a', NULL)", '["existing"]')).toMatchObject({ ok: false });
  });

  test("limits apply before mutation, including the combined list", () => {
    const maximum = Array.from({ length: MAX_SQL_LIST_VALUES }, (_, index) => String(index));
    expect(parseSqlFilterList(`(${maximum.join(",")})`).ok).toBe(true);
    expect(parseSqlFilterList(`(${[...maximum, "1001"].join(",")})`).ok).toBe(false);
    expect(prepareSqlFilterListImport("('new')", JSON.stringify(maximum)).ok).toBe(false);
    expect(parseSqlFilterList(" ".repeat(MAX_SQL_LIST_CHARACTERS + 1)).ok).toBe(false);
    expect(
      prepareSqlFilterListImport("('a')", "x".repeat(MAX_SQL_LIST_CHARACTERS * 4 + 1)).ok,
    ).toBe(false);
  });

  test("imported values use existing provider quoting, never the pasted SQL fragment", () => {
    const parsed = prepareSqlFilterListImport(
      "('O''Brien', 'a,b', '001', 'true', 'NULL', N'東京')",
      "",
    );
    if (!parsed.ok) throw Error(parsed.error);
    expect(parseFilterList(parsed.encoded)).toEqual([
      "O'Brien",
      "a,b",
      "001",
      "true",
      "NULL",
      "東京",
    ]);
    expect(compileSingleCondition("name", "in", parsed.encoded, "postgres", "text")).toBe(
      `"name" IN ('O''Brien', 'a,b', '001', 'true', 'NULL', '東京')`,
    );
    expect(compileSingleCondition("name", "notIn", parsed.encoded, "mysql", "varchar")).toContain(
      "`name` NOT IN ('O''Brien'",
    );
    expect(compileSingleCondition("name", "in", parsed.encoded, "mssql", "nvarchar")).toContain(
      "[name] IN (N'O''Brien'",
    );
    expect(compileSingleCondition("name", "in", parsed.encoded, "oracle", "varchar2")).toContain(
      "\"name\" IN ('O''Brien'",
    );
    expect(
      JSON.parse(compileSingleCondition("name", "in", parsed.encoded, "mongodb", "string") ?? ""),
    ).toEqual({ name: { $in: ["O'Brien", "a,b", "001", "true", "NULL", "東京"] } });
  });

  test("actual SQLite compilation selects quoted edge values without treating content as SQL", () => {
    const names = ["O'Brien", "a,b", "x'); DROP TABLE entries; --", "other"];
    const source = `(${names
      .slice(0, 3)
      .map((name) => `'${name.replaceAll("'", "''")}'`)
      .join(",")})`;
    const parsed = prepareSqlFilterListImport(source, "");
    if (!parsed.ok) throw Error(parsed.error);
    const db = new Database(":memory:");
    try {
      db.run("CREATE TABLE entries (name TEXT)");
      const insert = db.prepare("INSERT INTO entries VALUES (?)");
      for (const name of names) insert.run(name);
      for (const operator of ["in", "notIn"]) {
        const sql = compileSingleCondition("name", operator, parsed.encoded, "sqlite", "text");
        expect(db.query(`SELECT name FROM entries WHERE ${sql} ORDER BY rowid`).all()).toEqual(
          (operator === "in" ? names.slice(0, 3) : names.slice(3)).map((name) => ({ name })),
        );
      }
      expect(db.query("SELECT count(*) AS total FROM entries").get()).toEqual({ total: 4 });
    } finally {
      db.close();
    }
  });
});
