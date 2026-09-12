import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import type { DatabaseKind } from "../src/lib/db";
import { redisKeyFilter } from "../src/lib/redis-commands";
import {
  activeFilterCount,
  matchesResultFilter,
  resultFilterOperatorLabel,
} from "../src/lib/result-grid";
import {
  combineFilterConditions,
  compileSingleCondition,
  filterOperatorLabel,
  filterOperatorsForKind,
  filterSupportsOr,
  OPERATORS,
  operatorNeedsList,
  quoteLike,
  quoteString,
} from "../src/lib/sql-filter";

const kinds: DatabaseKind[] = [
  "postgres",
  "mysql",
  "sqlite",
  "mssql",
  "clickhouse",
  "mongodb",
  "redis",
  "oracle",
  "cassandra",
  "duckdb",
  "odbc",
];

for (const kind of kinds) {
  test(`${kind}: available operators compile and all labels are unique`, () => {
    const operators = filterOperatorsForKind(kind);
    expect(new Set(operators.map((op) => op.key)).size).toBe(operators.length);
    for (const translated of [false, true]) {
      const labels = operators.map((op) => filterOperatorLabel(op.key, translated, kind));
      expect(new Set(labels).size).toBe(operators.length);
      expect(labels.every(Boolean)).toBe(true);
    }
    for (const operator of operators) {
      const value = operatorNeedsList(operator.key) ? JSON.stringify(["1", "2"]) : "1";
      const compiled =
        kind === "redis"
          ? redisKeyFilter("key", operator.key, value)
          : compileSingleCondition("id", operator.key, value, kind);
      expect(compiled).toBeTruthy();
      if (kind === "mongodb") expect(() => JSON.parse(compiled!)).not.toThrow();
    }
  });
}

test("Cassandra excludes unsupported SQL operators and OR", () => {
  for (const operator of [
    "contains",
    "startsWith",
    "endsWith",
    "neq",
    "notIn",
    "isNull",
    "isNotNull",
  ]) {
    expect(filterOperatorsForKind("cassandra").some((op) => op.key === operator)).toBe(false);
    expect(compileSingleCondition("name", operator, "test", "cassandra")).toBeNull();
  }
  expect(filterSupportsOr("cassandra")).toBe(false);
  expect(combineFilterConditions(['"id" > 1', '"id" < 5'], "AND", "cassandra")).toBe(
    '"id" > 1 AND "id" < 5',
  );
});

test("dialects escape string literals and LIKE metacharacters correctly", () => {
  expect(quoteString("a\\'; --", "mysql")).toBe("CONCAT('a', CHAR(92 USING utf8mb4), '''; --')");
  expect(quoteString("a\\b'c", "clickhouse")).toBe("'a\\\\b''c'");
  expect(quoteLike("[a]%_!", "mssql")).toBe("![a]!%!_!!");
  expect(compileSingleCondition("name", "contains", "50%_\\", "clickhouse")).toBe(
    String.raw`toString("name") ILIKE '%50\\%\\_\\\\%'`,
  );
  expect(compileSingleCondition("name", "contains", "50%_!", "mysql")).toBe(
    "CAST(`name` AS CHAR) LIKE '%50!%!_!!%' ESCAPE '!'",
  );
});

test("MongoDB uses literal regexes, typed lists and explicit null checks", () => {
  expect(
    JSON.parse(
      compileSingleCondition(
        "name",
        "in",
        JSON.stringify(["a,b", "O'Brien", "001"]),
        "mongodb",
        "string",
      )!,
    ),
  ).toEqual({ name: { $in: ["a,b", "O'Brien", "001"] } });
  expect(JSON.parse(compileSingleCondition("id", "notIn", '["1","2"]', "mongodb")!)).toEqual({
    id: { $nin: [1, 2] },
  });
  expect(JSON.parse(compileSingleCondition("name", "startsWith", "a.b[0]$", "mongodb")!)).toEqual({
    name: { $regex: "^a\\.b\\[0\\]\\$", $options: "i" },
  });
  expect(JSON.parse(compileSingleCondition("name", "isNull", "", "mongodb")!)).toEqual({
    name: { $type: 10 },
  });
  expect(JSON.parse(compileSingleCondition("name", "isNotNull", "", "mongodb")!)).toEqual({
    name: { $exists: true, $ne: null },
  });
  expect(
    JSON.parse(combineFilterConditions(['{"id":{"$eq":1}}', '{"id":{"$eq":2}}'], "OR", "mongodb")),
  ).toEqual({ $or: [{ id: { $eq: 1 } }, { id: { $eq: 2 } }] });
});

test("SQLite executes all operators and treats wildcard characters as literal input", () => {
  const db = new Database(":memory:");
  try {
    db.run("CREATE TABLE entries (id INTEGER, name TEXT)");
    const insert = db.prepare("INSERT INTO entries VALUES (?, ?)");
    const values = ["50%_!\\O'Brien[a]", "prefix", "suffix", "null", null];
    values.forEach((value, index) => {
      insert.run(index + 1, value);
    });
    const cases: [string, string, number[]][] = [
      ["eq", "prefix", [2]],
      ["neq", "prefix", [1, 3, 4]],
      ["contains", "%_!\\O'", [1]],
      ["startsWith", "50%", [1]],
      ["endsWith", "[a]", [1]],
      ["in", '["prefix","null"]', [2, 4]],
      ["notIn", '["prefix","null"]', [1, 3]],
      ["isNull", "", [5]],
      ["isNotNull", "", [1, 2, 3, 4]],
    ];
    for (const [operator, value, ids] of cases) {
      const where = compileSingleCondition("name", operator, value, "sqlite", "TEXT");
      expect(db.query(`SELECT id FROM entries WHERE ${where} ORDER BY id`).all()).toEqual(
        ids.map((id) => ({ id })),
      );
    }
    for (const [operator, ids] of [
      ["gt", [3, 4, 5]],
      ["gte", [2, 3, 4, 5]],
      ["lt", [1]],
      ["lte", [1, 2]],
    ] as const) {
      const where = compileSingleCondition("id", operator, "2", "sqlite", "INTEGER");
      expect(db.query(`SELECT id FROM entries WHERE ${where} ORDER BY id`).all()).toEqual(
        ids.map((id) => ({ id })),
      );
    }
  } finally {
    db.close();
  }
});

test("local result filters share operators and labels without duplicate aliases", () => {
  for (const operator of OPERATORS) {
    expect(resultFilterOperatorLabel(operator.key, false)).toBe(
      filterOperatorLabel(operator.key, false),
    );
  }
  expect(matchesResultFilter("a,b", { operator: "in", value: '["a,b","x"]' })).toBe(true);
  expect(matchesResultFilter("x", { operator: "notIn", value: '["a,b"]' })).toBe(true);
  expect(matchesResultFilter(null, { operator: "notIn", value: '["a,b"]' })).toBe(false);
  expect(matchesResultFilter(12, { operator: "gt", value: "2" })).toBe(true);
  expect(matchesResultFilter(2, { operator: "gte", value: "2" })).toBe(true);
  expect(matchesResultFilter(2, { operator: "lt", value: "12" })).toBe(true);
  expect(matchesResultFilter(2, { operator: "lte", value: "2" })).toBe(true);
  expect(matchesResultFilter("prefix", { operator: "startsWith", value: "pre" })).toBe(true);
  expect(matchesResultFilter("prefix", { operator: "endsWith", value: "fix" })).toBe(true);
  expect(matchesResultFilter("x", { operator: "neq", value: "y" })).toBe(true);
  expect(activeFilterCount({ name: { operator: "in", value: "[]" } })).toBe(0);
});

test("PostgreSQL escapes backslashes independently of the session string mode", () => {
  expect(quoteString("a\\b'c", "postgres")).toBe("E'a\\\\b''c'");
});

test("Oracle lists over 1000 values keep IN and NOT IN grouping correct", () => {
  const values = JSON.stringify(Array.from({ length: 1001 }, (_, index) => String(index)));
  for (const operator of ["in", "notIn"]) {
    const compiled = compileSingleCondition("id", operator, values, "oracle");
    expect(compiled?.startsWith("(")).toBe(true);
    expect(compiled?.endsWith(")")).toBe(true);
    expect(compiled).toContain(operator === "in" ? ') OR "id" IN (' : ') AND "id" NOT IN (');
    expect(compiled?.match(/'\d+'/g)?.length).toBe(1001);
  }
});
