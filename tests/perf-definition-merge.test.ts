import { expect, test } from "bun:test";
import { measureScenario, reportScenario } from "../scripts/performance-report";
import { definitionHunks } from "../src/lib/definition-merge";

test("Worst-Case-Diff großer, völlig verschiedener Entwürfe bleibt im Budget", async () => {
  const source = Array.from({ length: 3_000 }, (_, index) => `  source_column_${index} text`).join(
    "\n",
  );
  const draft = Array.from({ length: 3_000 }, (_, index) => `  draft_column_${index} text`).join(
    "\n",
  );
  const heapBefore = process.memoryUsage().heapUsed;
  const diff = await measureScenario(() => {
    definitionHunks(source, draft);
  });
  const heapAfter = process.memoryUsage().heapUsed;
  await reportScenario("definition-merge-worst-case", {
    lines: 3_000,
    diff,
    heapDeltaBytes: heapAfter - heapBefore,
  });
  expect(definitionHunks(source, draft)).toEqual([
    { sourceStart: 0, sourceEnd: 3_000, draftStart: 0, draftEnd: 3_000 },
  ]);
  expect(diff.p95Ms).toBeLessThan(15);
  expect(heapAfter - heapBefore).toBeLessThan(64 * 1024 * 1024);
});
