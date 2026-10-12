import { expect, test } from "bun:test";
import { measureScenario, reportScenario } from "../scripts/performance-report";
import {
  OUTLINE_CACHE_LIMITS,
  QueryStatementOutlineCache,
} from "../src/lib/query-statement-outline";

test("current script outline preserves positions and invalidates when SQL or dialect changes", () => {
  const cache = new QueryStatementOutlineCache();
  const source = "SELECT 1;\n  SELECT 2;";
  const entries = cache.read(source, "postgres");
  expect(cache.retainedSummaries).toBe(0);
  expect(entries.map(({ line, column }) => ({ line, column }))).toEqual([
    { line: 1, column: 1 },
    { line: 2, column: 3 },
  ]);
  expect(cache.read(source, "postgres")).toBe(entries);
  expect(entries[0].summary).toEqual({ kind: "SELECT", preview: "SELECT 1;" });
  expect(entries[0].summary).toBe(entries[0].summary);
  expect(cache.retainedSummaries).toBe(1);
  cache.invalidate("SELECT 3;", "postgres");
  expect(cache.retainedEntries).toBe(0);
  expect(cache.retainedSummaries).toBe(0);
  const changed = cache.read("SELECT 3;", "postgres");
  expect(changed[0].summary.preview).toBe("SELECT 3;");
  expect(cache.read("SELECT 3;", "oracle")).not.toBe(changed);
});

test("outline retention is bounded while oversized scripts remain fully available", () => {
  const cache = new QueryStatementOutlineCache();
  const maximum = "SELECT 1;\n".repeat(OUTLINE_CACHE_LIMITS.entries);
  const entries = cache.read(maximum, "postgres");
  expect(entries).toHaveLength(OUTLINE_CACHE_LIMITS.entries);
  expect(cache.retainedEntries).toBe(OUTLINE_CACHE_LIMITS.entries);
  const oversized = `${maximum}SELECT 2;`;
  expect(cache.read(oversized, "postgres")).toHaveLength(OUTLINE_CACHE_LIMITS.entries + 1);
  expect(cache.retainedEntries).toBe(0);
  const largeText = `SELECT '${"x".repeat(OUTLINE_CACHE_LIMITS.sqlCharacters)}';`;
  expect(cache.read(largeText, "postgres")).toHaveLength(1);
  expect(cache.retainedEntries).toBe(0);
});

test("3000-statement navigator reuses its bounded outline across repeated tab switches", async () => {
  const sql = Array.from({ length: 3000 }, (_, index) => `SELECT ${index} AS value;`).join("\n");
  const cache = new QueryStatementOutlineCache();
  const baseline = await measureScenario(() => {
    const visible = new QueryStatementOutlineCache().read(sql, "postgres").slice(0, 40);
    for (const entry of visible) entry.summary;
  });
  const entries = cache.read(sql, "postgres");
  const initialSummaries = cache.retainedSummaries;
  for (const entry of entries.slice(0, 40)) entry.summary;
  expect(cache.retainedSummaries).toBe(40);
  const lookup = await measureScenario(() => {
    for (let iteration = 0; iteration < 3000; iteration++) {
      cache.invalidate(sql, "postgres");
      if (cache.read(sql, "postgres") !== entries) throw new Error("Outline was rebuilt");
    }
  });
  await reportScenario("query-statement-outline", {
    statements: entries.length,
    sqlCharacters: sql.length,
    baseline,
    repeatedTabSelections: 3000,
    lookup,
    retainedEntries: cache.retainedEntries,
    initialSummaries,
    visibleSummaries: cache.retainedSummaries,
    limits: OUTLINE_CACHE_LIMITS,
  });
  expect(entries).toHaveLength(3000);
  expect(entries[2999].line).toBe(3000);
  expect(entries[2999].summary.preview).toBe("SELECT 2999 AS value;");
  expect(cache.retainedEntries).toBe(3000);
  expect(cache.retainedSummaries).toBe(41);
  expect(baseline.p95Ms).toBeLessThan(120);
  expect(lookup.p95Ms).toBeLessThan(5);
  cache.invalidate(`${sql}\nSELECT 3000 AS changed;`, "postgres");
  expect(cache.retainedEntries).toBe(0);
});

test("one-line scripts build all statement positions within the same large-script budget", async () => {
  const sql = Array.from({ length: 3000 }, (_, index) => `SELECT ${index} AS value;`).join(" ");
  const build = await measureScenario(() => {
    new QueryStatementOutlineCache().read(sql, "postgres");
  });
  const entries = new QueryStatementOutlineCache().read(sql, "postgres");
  await reportScenario("query-statement-outline-one-line", {
    statements: entries.length,
    sqlCharacters: sql.length,
    build,
  });
  expect(entries).toHaveLength(3000);
  expect(entries.every((entry) => entry.line === 1)).toBe(true);
  expect(entries[2999].column).toBe(sql.indexOf("SELECT 2999 AS value;") + 1);
  expect(build.p95Ms).toBeLessThan(120);
  const mixed = new QueryStatementOutlineCache().read(
    "SELECT 1; SELECT 2;\n\n  SELECT 3; SELECT 4;",
    "postgres",
  );
  expect(mixed.map(({ line, column }) => ({ line, column }))).toEqual([
    { line: 1, column: 1 },
    { line: 1, column: 11 },
    { line: 3, column: 3 },
    { line: 3, column: 13 },
  ]);
});
