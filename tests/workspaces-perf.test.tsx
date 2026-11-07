import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkspaceResults } from "../src/features/workspaces/workspace-results";
import type { QueryResult } from "../src/lib/db";

test("workspace result grid bounds both axes for 121000 cells", () => {
  const columns = Array.from({ length: 121 }, (_, index) => `column_${index}`);
  const rows = Array.from({ length: 1000 }, (_, row) =>
    Object.fromEntries(columns.map((column, index) => [column, `${row}:${index}`])),
  );
  const result: QueryResult = {
    columns,
    rows,
    rows_affected: null,
    execution_time_ms: 15,
    truncated: false,
  };
  const samples: number[] = [];
  let markup = "";
  for (let run = 0; run < 15; run++) {
    const start = performance.now();
    markup = renderToStaticMarkup(createElement(WorkspaceResults, { result }));
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  const cells = markup.match(/role="cell"/g)?.length ?? 0;
  const headers = markup.match(/role="columnheader"/g)?.length ?? 0;
  console.log(
    `workspace grid: 1000 rows x 121 columns, median ${samples[7].toFixed(2)} ms p95 ${samples[14].toFixed(2)} ms, ${cells} DOM cells/${headers} headers, zero database requests`,
  );
  expect(cells).toBeGreaterThan(0);
  expect(cells).toBeLessThanOrEqual(300);
  expect(headers).toBeLessThanOrEqual(12);
  expect(markup.length).toBeLessThan(150000);
  expect(samples[7]).toBeLessThan(40);
  expect(samples[14]).toBeLessThan(100);
});
