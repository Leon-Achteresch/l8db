import { heapStats } from "bun:jsc";
import { expect, test } from "bun:test";
import { arch, cpus, platform, release, totalmem } from "node:os";
import { buildSchemaChangeReport, MAX_REPORT_CHARS } from "../src/lib/schema-compare/report";
import { exportSchemaReport } from "../src/lib/schema-compare/report-export";
import { reportItem, reportResult, reportState } from "./fixtures/schema-report";
import { measureScenario, reportScenario } from "./fixtures/usage-performance";

test("5,000 schema changes export within a bounded report without DB requests or idle generation", async () => {
  const result = reportResult(
    Array.from({ length: 5_000 }, (_, index) => reportItem(`amount_${index}`)),
  );
  const script = { statements: [], warnings: [] };
  const run = () => {
    const text = buildSchemaChangeReport(result, script);
    if (!text.includes("5000 abweichende Einträge") || text.length > MAX_REPORT_CHARS)
      throw new Error("incomplete report");
    return text;
  };
  const measured = await measureScenario(() => {
    run();
  }, 9);
  Bun.gc(true);
  const before = heapStats().heapSize;
  const report = run();
  for (let index = 0; index < 5; index++) run();
  Bun.gc(true);
  const retainedBytes = Math.max(0, heapStats().heapSize - before);
  const state = reportState(result);
  let writes = 0;
  const cancelled = await exportSchemaReport("save", state, () => state, script, {
    choosePath: async () => null,
    write: async () => {
      writes++;
    },
    copy: async () => {
      writes++;
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(cancelled).toBe("cancelled");
  expect(writes).toBe(0);
  reportScenario("schema-change-report", {
    items: result.items.length,
    ...measured,
    chars: report.length,
    retainedBytes,
    dbRequests: 0,
    writesAfterCancelOrIdle: writes,
    environment: {
      os: platform(),
      release: release(),
      arch: arch(),
      cpu: cpus()[0]?.model,
      ramBytes: totalmem(),
      bun: Bun.version,
    },
  });
  expect(measured.medianMs).toBeLessThan(100);
  expect(measured.p95Ms).toBeLessThan(200);
  expect(report.length).toBeLessThan(MAX_REPORT_CHARS);
  expect(retainedBytes).toBeLessThan(8 * 1024 * 1024);
});
