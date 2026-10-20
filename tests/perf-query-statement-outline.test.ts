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

function oracleScript(statements: number): string {
  const parts: string[] = [];
  for (let index = 0; index < statements; index++) {
    if (index % 50 === 0) parts.push(`PROMPT step ${index}`);
    parts.push(
      index % 10 === 0
        ? `BEGIN\n  x := q'[${index};]' || &&tag;\n\n  NULL;\nEND;\n/`
        : `SELECT &col, '${index};' FROM t_${index} WHERE id = ${index};`,
    );
  }
  return parts.join("\n\n");
}

test("5000-statement Oracle scripts with SQL*Plus commands split within the large-script budget", async () => {
  const { splitSqlStatements } = await import("../src/lib/sql-statements");
  const sql = oracleScript(5000);
  const split = await measureScenario(() => {
    splitSqlStatements(sql, "oracle");
  });
  const result = splitSqlStatements(sql, "oracle");
  await reportScenario("query-oracle-script-split", {
    statements: result.statements.length,
    commands: result.commands.length,
    sqlCharacters: sql.length,
    split,
  });
  expect(result.statements).toHaveLength(5000);
  expect(result.commands).toHaveLength(100);
  expect(split.p95Ms).toBeLessThan(250);
});

test("200 @-files with 5000 statements expand with one read per file", async () => {
  const { splitSqlStatements } = await import("../src/lib/sql-statements");
  const { expandIncludes, scriptItems } = await import("../src/lib/sql-statements/includes");
  const files = new Map<string, string>();
  for (let file = 0; file < 200; file++)
    files.set(
      `/s/f${file}.sql`,
      Array.from({ length: 25 }, (_, row) => `INSERT INTO t VALUES (${file}, ${row});`).join("\n"),
    );
  const top = `${Array.from({ length: 200 }, (_, file) => `@f${file}`).join("\n")}\n@f0`;
  let reads = 0;
  const run = () =>
    expandIncludes(scriptItems(splitSqlStatements(top, "oracle")), {
      file: "/s/main.sql",
      searchPath: [],
      read: async (path) => {
        reads++;
        const text = files.get(path);
        if (text === undefined) throw new Error("missing");
        return text;
      },
    });
  const expand = await measureScenario(async () => {
    await run();
  });
  reads = 0;
  const items = await run();
  await reportScenario("query-oracle-script-includes", {
    files: files.size,
    statements: items.length,
    readsPerRun: reads,
    expand,
  });
  expect(items).toHaveLength(5025);
  expect(reads).toBe(200);
  expect(expand.p95Ms).toBeLessThan(250);
});

test("substituting 5000 statements stays within budget without retained state", async () => {
  const { splitSqlStatements } = await import("../src/lib/sql-statements");
  const { substitute } = await import("../src/lib/sql-statements/sqlplus");
  const texts = splitSqlStatements(oracleScript(5000), "oracle").statements.map(
    (statement) => statement.text,
  );
  const values = { COL: "name", TAG: "'x'" };
  const runOnce = () => {
    const state = { defines: {}, marker: "&", escape: null };
    for (const text of texts) substitute(text, state, values);
  };
  const timing = await measureScenario(runOnce);
  Bun.gc(true);
  const before = process.memoryUsage().heapUsed;
  for (let run = 0; run < 5; run++) runOnce();
  Bun.gc(true);
  const retainedBytes = process.memoryUsage().heapUsed - before;
  await reportScenario("query-oracle-script-substitution", {
    statements: texts.length,
    timing,
    retainedBytes,
  });
  expect(substitute(texts[1], { defines: {}, marker: "&", escape: null }, values).text).toBe(
    "SELECT name, '1;' FROM t_1 WHERE id = 1;",
  );
  expect(timing.p95Ms).toBeLessThan(150);
  expect(retainedBytes).toBeLessThan(4 * 1024 * 1024);
});
