import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { measureScenario, reportScenario } from "../scripts/performance-report";
import { ScriptResultList, type ScriptRunEntry } from "../src/features/query/script-result-list";
import { scriptPageForEntry, scriptResultPage } from "../src/features/query/script-result-page";

const entries: ScriptRunEntry[] = Array.from({ length: 2048 }, (_, i) => ({
  index: i,
  sql: `SELECT ${i} AS probe;`,
  status: i % 173 === 172 ? "error" : i % 211 === 210 ? "warning" : "success",
  start: i * 25,
  end: i * 25 + 20,
  durationMs: 1,
  rowCount: 1,
  rowsAffected: null,
  error: i % 173 === 172 ? "Beispielmeldung" : null,
  feedback: "1 Zeile ausgewählt.",
}));

test("all and filtered pages preserve source order, positions and full-run counts", () => {
  const sparse = entries.slice(0, 167).map(
    (entry, position): ScriptRunEntry => ({
      ...entry,
      index: position * 2,
      status: position % 2 ? "warning" : "error",
    }),
  );
  sparse[23].status = "skipped";
  sparse[24].status = "ignored";
  sparse[25].status = "pending";
  sparse[26].status = "running";
  const issues = sparse.filter((item) => item.status === "error" || item.status === "warning");
  expect(scriptResultPage(sparse, 1, true).visible).toEqual(issues.slice(50, 100));
  const last = scriptResultPage(sparse, 999, true);
  expect(last.visible).toEqual(issues.slice(150));
  expect(last.visible[0]).toBe(issues[150]);
  expect(last.failed + last.warned).toBe(issues.length);
  expect(last.currentPage).toBe(3);
  expect(scriptPageForEntry(sparse, issues[150].index)).toBe(3);
  expect(scriptPageForEntry(sparse, null)).toBe(0);
  expect(scriptPageForEntry(sparse, 999)).toBe(0);
  expect(scriptResultPage(entries.slice(0, 50), 2, false).lastPage).toBe(0);
  expect(scriptResultPage(entries.slice(0, 51), 2, false).visible).toEqual([entries[50]]);
  expect(scriptResultPage(entries.slice(0, 50), 2, true).visible).toEqual([]);
  expect(scriptResultPage([], 3, false).currentPage).toBe(0);
});

test("2048 script results render one page within the markup and latency budgets", async () => {
  let bytes = 0;
  let rows = 0;
  const timing = await measureScenario(() => {
    const html = renderToStaticMarkup(
      createElement(ScriptResultList, {
        entries,
        activeIndex: null,
        onSelect() {},
        onClose() {},
        note: "Autocommit",
      }),
    );
    rows = (html.match(/ AS probe;/g) ?? []).length;
    bytes = Buffer.byteLength(html);
  }, 31);
  await reportScenario("script-result-list-pages", {
    ...timing,
    entries: entries.length,
    rows,
    bytes,
  });
  expect(rows).toBe(50);
  expect(bytes).toBeLessThan(80 * 1024);
  expect(timing.medianMs).toBeLessThan(12);
  expect(timing.p95Ms).toBeLessThan(30);
});
