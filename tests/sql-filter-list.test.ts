import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import {
  changeFilterOperator,
  compileSingleCondition,
  parseFilterList,
} from "../src/lib/sql-filter";

const list = JSON.stringify;

test("IN and NOT IN quote each list entry and preserve punctuation", () => {
  expect(compileSingleCondition('na"me', "in", list(["O'Brien", "a,b", "x); --"]))).toBe(
    `"na""me" IN ('O''Brien', 'a,b', 'x); --')`,
  );
  expect(compileSingleCondition("id", "notIn", list(["1", "-2.5", "true"]))).toBe(
    '"id" NOT IN (1, -2.5, true)',
  );
  expect(compileSingleCondition("id", "in", list(["42", "7"]), "oracle")).toBe(
    `"id" IN ('42', '7')`,
  );
  expect(compileSingleCondition("id", "notIn", list(["42"]), "mssql")).toBe("[id] NOT IN (N'42')");
  expect(compileSingleCondition("name", "in", list(["a,b"]), "mysql")).toBe("`name` IN ('a,b')");
});

test("empty lists never generate invalid SQL", () => {
  for (const operator of ["in", "notIn"]) {
    for (const value of ["", "[]", list(["", "  "])]) {
      expect(compileSingleCondition("id", operator, value)).toBeNull();
    }
    expect(compileSingleCondition("", operator, list(["1"]))).toBeNull();
  }
});

test("switching operators preserves literal values and list entries", () => {
  const literal = '["literal JSON"]';
  const encoded = changeFilterOperator(literal, "eq", "in");
  expect(parseFilterList(encoded)).toEqual([literal]);
  expect(changeFilterOperator(encoded, "in", "notIn")).toBe(encoded);
  expect(changeFilterOperator(encoded, "notIn", "eq")).toBe(literal);
  expect(changeFilterOperator("[]", "in", "eq")).toBe("");
  expect(changeFilterOperator("", "eq", "in")).toBe("[]");
  expect(parseFilterList("a,b")).toEqual(["a,b"]);
});

test("generated lists select and exclude the expected rows in SQLite", () => {
  const db = new Database(":memory:");
  try {
    db.run("CREATE TABLE entries (id INTEGER, name TEXT)");
    const names = ["Berlin", "O'Brien", "a,b", "x'); DROP TABLE entries; --"];
    const insert = db.prepare("INSERT INTO entries VALUES (?, ?)");
    names.forEach((name, index) => {
      insert.run(index + 1, name);
    });
    for (const operator of ["in", "notIn"]) {
      const where = compileSingleCondition("name", operator, list(names.slice(1)), "sqlite");
      expect(db.query(`SELECT id FROM entries WHERE ${where} ORDER BY id`).all()).toEqual(
        (operator === "in" ? [2, 3, 4] : [1]).map((id) => ({ id })),
      );
    }
    const where = compileSingleCondition("id", "in", list(["1", "3"]), "sqlite");
    expect(db.query(`SELECT name FROM entries WHERE ${where} ORDER BY id`).all()).toEqual([
      { name: "Berlin" },
      { name: "a,b" },
    ]);
    expect(db.query("SELECT count(*) AS total FROM entries").get()).toEqual({ total: 4 });
  } finally {
    db.close();
  }
});

test("list values respect column types, NULL text and Unicode", () => {
  expect(
    compileSingleCondition("code", "in", list(["001", "true", "null"]), "postgres", "text"),
  ).toBe(`"code" IN ('001', 'true', 'null')`);
  expect(compileSingleCondition("enabled", "eq", "true", "mssql", "bit")).toBe("[enabled] = 1");
  expect(compileSingleCondition("name", "eq", "東京", "mssql", "nvarchar")).toBe(
    "[name] = N'東京'",
  );
  expect(
    compileSingleCondition("id", "in", list(["1", "2"]), "clickhouse", "Nullable(UInt64)"),
  ).toBe('"id" IN (1, 2)');
});
