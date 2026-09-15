import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { normalizeFilterExpressionQuotes, parseFilterExpression } from "../src/lib/filter-parser";
import { compileFilterConditions } from "../src/lib/sql-filter";

const columns = ["STATUS", "name", "id", 'odd"column', "with]bracket", "with`tick"];
const eq = (column: string, value: string) =>
  `CAST("${column}" AS TEXT) LIKE '${value}' ESCAPE '!'`;
const compile = (source: string) => {
  const parsed = parseFilterExpression(source, columns, "sqlite");
  return compileFilterConditions(parsed.conditions, parsed.combinator, "sqlite");
};

test("normalizes typographic opening quotes for Oracle and preserves text punctuation", () => {
  for (const source of [`"STATUS" = ‚ABG'`, `"STATUS" = ‘ABG’`, `"STATUS" = ‚ABG‘`]) {
    const parsed = parseFilterExpression(source, columns, "oracle");
    expect(compileFilterConditions(parsed.conditions, parsed.combinator, "oracle")).toBe(
      `UPPER(TO_CHAR("STATUS")) LIKE UPPER('ABG') ESCAPE '!'`,
    );
    expect(normalizeFilterExpressionQuotes(source)).toBe(`"STATUS" = 'ABG'`);
  }
  expect(compile("name = ‘O’Brien’")).toBe(eq("name", "O’Brien"));
  expect(compile("name = ‚O'Brien'")).toBe(eq("name", "O''Brien"));
  expect(normalizeFilterExpressionQuotes("name IN (‚ABG', ‘ANG’) AND id >= 1")).toBe(
    "name IN ('ABG', 'ANG') AND id >= 1",
  );
  for (const source of [
    `name = 'O’Brien'`,
    `name = 'Er sagt ‚ABG‘'`,
    `name = 'O''Brien'`,
    `"‚STATUS" = 'ABG'`,
    `name = q'[O'Brien sagt ‚ABG‘]'`,
    `id = 1 -- ‚Kommentar'`,
    `name = ‚ABG`,
  ]) {
    expect(normalizeFilterExpressionQuotes(source)).toBe(source);
  }
  expect(() => parseFilterExpression("name = ‚ABG", columns)).toThrow("nicht geschlossen");
});

test("filter expressions normalize extra outer quotes and preserve internal apostrophes", () => {
  for (const expression of [
    `"STATUS" = 'ANG'`,
    `"STATUS" = '''ANG'''`,
    `"STATUS" = '''''ANG'''''`,
  ]) {
    expect(compile(expression)).toBe(eq("STATUS", "ANG"));
  }
  expect(compile(`name = 'O''Brien'`)).toBe(eq("name", "O''Brien"));
  expect(compile(`name = '''O''''Brien'''`)).toBe(eq("name", "O''Brien"));
  expect(compile(`name = '  ANG  '`)).toBe(eq("name", "  ANG  "));
});

test("parses identifiers, comparisons, optional WHERE and uniform parenthesized groups", () => {
  const parsed = parseFilterExpression(
    `where (status != 'ANG' and (id >= -2.5 AND id <= 4))`,
    columns,
  );
  expect(parsed.combinator).toBe("AND");
  expect(
    parsed.conditions.map(({ column, operator, value }) => ({ column, operator, value })),
  ).toEqual([
    { column: "STATUS", operator: "neq", value: "ANG" },
    { column: "id", operator: "gte", value: "-2.5" },
    { column: "id", operator: "lte", value: "4" },
  ]);
  expect(compile(`("odd""column" > 1 OR [with]]bracket] < 2) OR \`with\`\`tick\` = TRUE`)).toBe(
    '"odd""column" > 1 OR "with]bracket" < 2 OR "with`tick" = true',
  );
});

test("parses lists and NULL checks without splitting quoted punctuation or keywords", () => {
  expect(compile(`name IN ('a,b', 'AND OR', 'O''Brien', '''ANG''')`)).toBe(
    `(${eq("name", "a,b")} OR ${eq("name", "AND OR")} OR ${eq("name", "O''Brien")} OR ${eq("name", "ANG")})`,
  );
  expect(compile(`id NOT IN (1, 2) AND name IS NOT NULL AND "STATUS" IS NULL`)).toBe(
    '"id" NOT IN (1, 2) AND "name" IS NOT NULL AND "STATUS" IS NULL',
  );
  const parsed = parseFilterExpression(`id = '001'`, columns);
  expect(
    compileFilterConditions(parsed.conditions, parsed.combinator, "postgres", [
      { name: "id", data_type: "integer" },
    ]),
  ).toBe(`"id" = 001`);
});

test("rejects incomplete, unsupported or unsafe expressions without dropping clauses", () => {
  for (const expression of [
    "",
    "WHERE",
    "id =",
    "id = 1 garbage",
    "id = 1; DROP TABLE entries",
    "id = 1 -- comment",
    "id = 1 /* comment */",
    "id = 1 UNION SELECT 1",
    "name = 'unclosed",
    "missing = 1",
    "id IN ()",
    "id IN (1,)",
    "id IN (SELECT id FROM entries)",
    "(id = 1",
    "id = 1)",
    "id = 1 AND",
    "id = 1 OR id = 2 AND id = 3",
    "(id = 1 OR id = 2) AND id = 3",
    "name = ''",
  ]) {
    expect(() => parseFilterExpression(expression, columns), expression).toThrow();
  }
  expect(() => parseFilterExpression('"id = 1', columns)).toThrow("Position 1");
  expect(() => parseFilterExpression("id = 1".repeat(4000), columns)).toThrow("zu lang");
  expect(() =>
    parseFilterExpression(`${"(".repeat(66)}id = 1${")".repeat(66)}`, columns),
  ).toThrow();
});

test("accepts unquoted values, LIKE, BETWEEN, NULL comparisons and case-insensitive columns", () => {
  const conditions = (source: string) =>
    parseFilterExpression(source, columns).conditions.map(({ column, operator, value }) => ({
      column,
      operator,
      value,
    }));
  expect(conditions("status = abg")).toEqual([{ column: "STATUS", operator: "eq", value: "abg" }]);
  expect(conditions(`"status" = 'ANG'`)).toEqual([
    { column: "STATUS", operator: "eq", value: "ANG" },
  ]);
  expect(conditions("name like '%an%'")).toEqual([
    { column: "name", operator: "contains", value: "an" },
  ]);
  expect(conditions("name LIKE 'an%'")[0].operator).toBe("startsWith");
  expect(conditions("name ILIKE '%an'")[0].operator).toBe("endsWith");
  expect(conditions("name LIKE 'an'")[0].operator).toBe("eq");
  expect(conditions("id between 1 and 5")).toEqual([
    { column: "id", operator: "gte", value: "1" },
    { column: "id", operator: "lte", value: "5" },
  ]);
  expect(conditions("name = NULL AND id != null")).toEqual([
    { column: "name", operator: "isNull", value: "" },
    { column: "id", operator: "isNotNull", value: "" },
  ]);
  expect(conditions("name in (abc, 2026-01-01, 3)")).toEqual([
    { column: "name", operator: "in", value: '["abc","2026-01-01","3"]' },
  ]);
  for (const source of ["name = id", "name like '%a%b%'", "name like '%'", "id = 1;", "id = ;"]) {
    expect(() => parseFilterExpression(source, columns), source).toThrow();
  }
});

test("honors provider restrictions and ambiguous identifiers", () => {
  expect(() => parseFilterExpression("id != 1", columns, "cassandra")).toThrow();
  expect(() => parseFilterExpression("id = 1 OR id = 2", columns, "cassandra")).toThrow();
  expect(() => parseFilterExpression("id = 1", columns, "mongodb")).toThrow();
  expect(() => parseFilterExpression("id = 1", columns, "redis")).toThrow();
  expect(() => parseFilterExpression("Status = 1", ["STATUS", "status"])).toThrow();
  expect(parseFilterExpression("id IN (1, 2)", columns, "cassandra").conditions[0].operator).toBe(
    "in",
  );
});

test("compiled parsed filters select the expected SQLite rows and safely quote SQL-looking values", () => {
  const db = new Database(":memory:");
  try {
    db.run('CREATE TABLE entries (id INTEGER, "STATUS" TEXT, name TEXT)');
    const insert = db.prepare("INSERT INTO entries VALUES (?, ?, ?)");
    insert.run(1, "ANG", "O'Brien");
    insert.run(2, "'ANG'", "a,b");
    insert.run(3, "OTHER", "x'); DROP TABLE entries; --");
    const rows = (expression: string) =>
      db.query(`SELECT id FROM entries WHERE ${compile(expression)} ORDER BY id`).all();
    expect(rows(`"STATUS" = '''ANG'''`)).toEqual([{ id: 1 }]);
    expect(rows("status = ang")).toEqual([{ id: 1 }]);
    expect(rows("name like '%brien'")).toEqual([{ id: 1 }]);
    expect(rows("status <> 'ang'")).toEqual([{ id: 2 }, { id: 3 }]);
    expect(rows(`name IN ('O''Brien', 'a,b') AND id < 3`)).toEqual([{ id: 1 }, { id: 2 }]);
    expect(rows(`name = 'x''); DROP TABLE entries; --'`)).toEqual([{ id: 3 }]);
    expect(db.query("SELECT count(*) AS total FROM entries").get()).toEqual({ total: 3 });
  } finally {
    db.close();
  }
});
