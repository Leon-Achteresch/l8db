import { heapStats } from "bun:jsc";
import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { measureScenario, reportScenario } from "../scripts/performance-report";
import { firstLine as monitorPreview } from "../src/features/monitor/monitor-view/format";
import { firstLine, formatTime } from "../src/features/query/query-history-panel/format";
import { ScriptResultList } from "../src/features/query/script-result-list";
import { sqlPreviewLine } from "../src/lib/sql-preview-line";
import { summarizeStatement } from "../src/lib/sql-statements";

test("history previews preserve the first nonempty line and bounded display text", () => {
  expect(firstLine("\n \t\r\n  SELECT 1;  \r\nSELECT 2;")).toBe("SELECT 1;");
  expect(firstLine(" \t\r\n")).toBe("");
  expect(firstLine("x".repeat(80))).toHaveLength(80);
  expect(firstLine("x".repeat(81))).toBe(`${"x".repeat(80)}…`);
  expect(formatTime(Number.NaN)).toBe("Invalid Date");
  const timestamp = 1_700_000_000_000;
  expect(formatTime(timestamp)).toBe(
    new Date(timestamp).toLocaleString("de-DE", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }),
  );
});

test("a viewport of maximum-length SQL previews never builds arrays for the unseen statements", async () => {
  const sql = `\n${"SELECT value;\n".repeat(14_000)}`;
  const timing = await measureScenario(() => {
    for (let index = 0; index < 100; index++) expect(firstLine(sql)).toBe("SELECT value;");
  });
  expect(timing.p95Ms).toBeLessThan(30);
  await reportScenario("history-sql-previews", {
    ...timing,
    sqlCharacters: sql.length,
    previews: 100,
    maximumPreviewCharacters: 81,
  });
});

test("SQL previews preserve whitespace, truncation and ellipses at each display width", () => {
  for (const [limit, suffix] of [
    [80, "…"],
    [110, "…"],
    [120, ""],
  ] as const) {
    for (const width of [1, limit - 1, limit, limit + 1]) {
      for (const tail of ["", "\r\nnext", " \t\r\nnext", "   x  ", "\u00a0x", "😀"]) {
        const sql = `\ufeff\n\t\r\n  ${"x".repeat(width)}${tail}`;
        const line =
          sql
            .split("\n")
            .map((line) => line.trim())
            .find(Boolean) ?? "";
        expect(sqlPreviewLine(sql, limit, suffix)).toBe(
          line.slice(0, limit) + (line.length > limit ? suffix : ""),
        );
      }
    }
  }
  expect(sqlPreviewLine("\r\n   \ufeff ", 110)).toBe("");
  expect(summarizeStatement("  \n \t")).toEqual({ kind: "SQL", preview: "Leeres Statement" });
  const sql = `SELECT ${"x".repeat(200)}\nsecond line`;
  expect(monitorPreview(sql)).toBe(`${sql.slice(0, 110)}…`);
  const html = renderToStaticMarkup(
    createElement(ScriptResultList, {
      entries: [
        {
          index: 0,
          sql,
          start: 0,
          end: sql.length,
          status: "success",
          durationMs: 1,
          rowCount: null,
          rowsAffected: null,
          error: null,
        },
      ],
      activeIndex: null,
      onSelect() {},
      onClose() {},
      note: "Autocommit",
    }),
  );
  expect(html).toContain(`>${sql.slice(0, 120)}</span>`);
  expect(html).not.toContain("second line");
});

test("monitor and outline previews keep formatting large procedure bodies within budget", async () => {
  const statements = Array.from({ length: 64 }, (_, index) => {
    const header = `CREATE PROCEDURE report_${index} AS`;
    return { sql: `\r\n  ${header}  \r\n${"  SELECT 1;\n".repeat(14_000)}END;`, header };
  });
  const results: string[] = [];
  const format = () => {
    results.length = 0;
    for (const { sql, header } of statements) {
      const monitor = monitorPreview(sql);
      const outline = summarizeStatement(sql).preview;
      if (monitor !== header || outline !== header) throw new Error("Unexpected SQL preview");
      results.push(monitor, outline);
    }
  };
  format();
  Bun.gc(true);
  const before = heapStats().heapSize;
  const timing = await measureScenario(format, 21);
  Bun.gc(true);
  const retainedBytes = Math.max(0, heapStats().heapSize - before);
  expect(results).toHaveLength(128);
  expect(timing.medianMs).toBeLessThan(1);
  expect(timing.p95Ms).toBeLessThan(3);
  expect(retainedBytes).toBeLessThan(1024 * 1024);
  await reportScenario("monitor-outline-sql-previews", {
    ...timing,
    retainedBytes,
    previews: results.length,
    sqlCharacters: statements.reduce((sum, row) => sum + row.sql.length, 0),
  });
});

test("timestamps for a large history reuse formatting resources", async () => {
  let last = "";
  const timing = await measureScenario(() => {
    for (let index = 0; index < 5000; index++) last = formatTime(1_700_000_000_000 + index * 1000);
  });
  expect(last).not.toBe("");
  expect(timing.p95Ms).toBeLessThan(50);
  await reportScenario("history-timestamps", { ...timing, entries: 5000 });
});
