import { expect, test } from "bun:test";
import { type SqlObjectRegistry, suggestCompletions } from "@/lib/sql-intellisense";

const registry: SqlObjectRegistry = {
  schemas: ["audit_ch"],
  tables: [{ schema: "audit_ch", name: "types" }],
  views: [],
  columns: [],
  functions: [],
  procedures: [],
};

const functionNames = (dialect: SqlObjectRegistry["dialect"]) =>
  suggestCompletions({ ...registry, dialect }, "SELECT JSON", "SELECT JSON")
    .filter((s) => s.kind === "function")
    .map((s) => s.label);

test("ClickHouse completions offer ClickHouse functions instead of PostgreSQL ones", () => {
  const clickhouse = functionNames("clickhouse");
  expect(clickhouse).toContain("JSONExtractString");
  expect(clickhouse).toContain("JSONHas");
  expect(clickhouse).toContain("toStartOfDay");
  expect(clickhouse).not.toContain("JSONB_AGG");
  expect(clickhouse).not.toContain("JSON_EACH");
  expect(new Set(clickhouse).size).toBe(clickhouse.length);
  expect(functionNames("postgres")).toContain("JSONB_AGG");
});
