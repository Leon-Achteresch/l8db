import { heapStats } from "bun:jsc";
import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FilterValueInput } from "../src/features/filters/filter-value-input";
import {
  MAX_SQL_LIST_CHARACTERS,
  prepareSqlFilterListImport,
} from "../src/lib/sql-filter-list-import";
import { measureScenario, reportScenario } from "./fixtures/usage-performance";

test("1000 imported literals keep parsing, chip SSR and retained memory bounded without background work", async () => {
  const source = `(${Array.from({ length: 1000 }, (_, index) => `'value-${index}, O''Brien ${"x".repeat(64)}'`).join(",")})`;
  const prepare = () => {
    const result = prepareSqlFilterListImport(source, "");
    if (!result.ok || result.total !== 1000) throw Error("incomplete list");
    return result;
  };
  const parsing = await measureScenario(() => {
    prepare();
  }, 21);
  const result = prepare();
  let htmlBytes = 0;
  let chips = 0;
  const render = () => {
    const html = renderToStaticMarkup(
      createElement(FilterValueInput, {
        operator: "in",
        value: result.encoded,
        onValueChange: () => {
          throw Error("unexpected filter change");
        },
      }),
    );
    htmlBytes = Buffer.byteLength(html);
    chips = (html.match(/Wert entfernen:/g) ?? []).length;
    if (chips !== 1000 || htmlBytes > 2 * 1024 * 1024) throw Error("unbounded or incomplete chips");
  };
  const rendering = await measureScenario(render, 9);
  Bun.gc(true);
  const before = heapStats().heapSize;
  for (let index = 0; index < 10; index++) {
    prepare();
    render();
  }
  Bun.gc(true);
  const retainedBytes = Math.max(0, heapStats().heapSize - before);
  const oversized = "x".repeat(MAX_SQL_LIST_CHARACTERS + 1);
  const rejecting = await measureScenario(() => {
    if (prepareSqlFilterListImport(oversized, "").ok) throw Error("accepted oversized input");
  }, 21);
  reportScenario("sql-filter-list-import", {
    values: 1000,
    sourceCharacters: source.length,
    parsing,
    rendering,
    rejecting,
    chips,
    htmlBytes,
    retainedBytes,
    dbRequests: 0,
    backgroundTasks: 0,
    bun: Bun.version,
  });
  expect(parsing.medianMs).toBeLessThan(20);
  expect(parsing.p95Ms).toBeLessThan(40);
  expect(rendering.medianMs).toBeLessThan(100);
  expect(rendering.p95Ms).toBeLessThan(200);
  expect(rejecting.p95Ms).toBeLessThan(5);
  expect(retainedBytes).toBeLessThan(8 * 1024 * 1024);
});
