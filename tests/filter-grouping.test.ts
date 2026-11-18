import { expect, test } from "bun:test";
import { parseFilterExpression, readPostgresFilterGroups } from "../src/lib/filter-parser";
import { compileFilterConditions } from "../src/lib/sql-filter";

const columns = ["id", "status", "Label", 'doubled"name'];
const read = (sql: string) => readPostgresFilterGroups(sql, columns);

test("reads PostgreSQL precedence and explicit groups without rewriting their predicates", () => {
  expect(read("ID = 1 or id = 2 AND id IS NULL")).toEqual({
    combinator: "OR",
    children: ["ID = 1", { combinator: "AND", children: ["id = 2", "id IS NULL"] }],
  });
  expect(read(`(id = 1 OR ("Label" = '' AND id = 2)) AND id = 3`)).toEqual({
    combinator: "AND",
    children: [
      {
        combinator: "OR",
        children: ["id = 1", { combinator: "AND", children: [`"Label" = ''`, "id = 2"] }],
      },
      "id = 3",
    ],
  });
  expect(read("id = 1 AND id = 2")).toEqual({
    combinator: "AND",
    children: ["id = 1", "id = 2"],
  });
});

test("keeps BETWEEN, literal lists, quoted keywords and spacing intact", () => {
  expect(
    read(`id BETWEEN -2 AND 2 AND status IN ('OR', 'O''Brien') OR "doubled""name" NOT IN (1, 2)`),
  ).toEqual({
    combinator: "OR",
    children: [
      {
        combinator: "AND",
        children: ["id BETWEEN -2 AND 2", "status IN ('OR', 'O''Brien')"],
      },
      '"doubled""name" NOT IN (1, 2)',
    ],
  });
  expect(read(`  status  =  'a  AND  b' \n`)).toBe("status  =  'a  AND  b'");
  expect(read(`status ILIKE '%a_b%'`)).toBe(`status ILIKE '%a_b%'`);
});

test("readback agrees with builder output without expanding the builder grammar", () => {
  const compiled = compileFilterConditions(
    [
      { column: "status", operator: "eq", value: "AND O'Brien" },
      { column: "id", operator: "isNotNull", value: "" },
    ],
    "AND",
    "postgres",
  );
  expect(compiled).toBe(`"status" = 'AND O''Brien' AND "id" IS NOT NULL`);
  expect(read(compiled)).toEqual({
    combinator: "AND",
    children: [`"status" = 'AND O''Brien'`, '"id" IS NOT NULL'],
  });
  const mixed = `${compiled} OR id = 1`;
  expect(() => parseFilterExpression(mixed, columns, "postgres")).toThrow("Gemischte AND/OR");
  expect(read(mixed)).toEqual({
    combinator: "OR",
    children: [read(compiled), "id = 1"],
  });
});

test("ambiguous or unhandled SQL never yields a partial group", () => {
  for (const source of [
    "WHERE id = 1",
    "NOT (id = 1 OR id = 2)",
    "(id = 1 OR id = 2",
    "id = 1 OR",
    "id = 1 OR lower(status) = 'ok'",
    "id = 1 OR id IN (SELECT id FROM other)",
    "id = 1 OR id = status",
    "id = 1 OR id = 1::int",
    "id = 1 OR id !=-2",
    "id = 1 OR id = 2 ORDER BY id",
    "id = 1/* comment */ OR id = 2",
    "id = 1 OR id = 2 -- AND id = 3",
    "id = 1 OR id = 2; SELECT 1",
    "status = 'a'\n'b' OR id = 1",
    "status = $$AND$$ OR id = 1",
    "status = E'AND' OR id = 1",
    "status = 'one\\two' OR id = 1",
    "status = ‚ok' OR id = 1",
    "id = NULL OR id = 1",
    "label = 'ok' OR id = 1",
    "\"STATUS\" = 'ok' OR id = 1",
    "[status] = 'ok' OR id = 1",
    "id = 1\u00a0OR id = 2",
    `${"(".repeat(66)}id = 1${")".repeat(66)}`,
    `${"id = 1 OR ".repeat(2500)}id = 2`,
  ]) {
    expect(() => read(source), source).toThrow();
  }
  expect(read("id != -2")).toBe("id != -2");
});
