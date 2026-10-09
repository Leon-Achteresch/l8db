import { expect, test } from "bun:test";
import { measureScenario, reportScenario } from "../scripts/performance-report";
import { firstLine, formatTime } from "../src/features/query/query-history-panel/format";

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

test("timestamps for a large history reuse formatting resources", async () => {
  let last = "";
  const timing = await measureScenario(() => {
    for (let index = 0; index < 5000; index++) last = formatTime(1_700_000_000_000 + index * 1000);
  });
  expect(last).not.toBe("");
  expect(timing.p95Ms).toBeLessThan(50);
  await reportScenario("history-timestamps", { ...timing, entries: 5000 });
});
