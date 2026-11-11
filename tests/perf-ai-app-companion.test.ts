import { heapSize } from "bun:jsc";
import { expect, test } from "bun:test";
import { arch, cpus, platform, totalmem } from "node:os";
import { APP_FEATURE_CHARS, searchAppFeatures } from "@/lib/ai/app-companion";
import { FEATURE_CATALOG } from "@/lib/discovery/catalog";
import { measureScenario, reportScenario } from "../scripts/performance-report";

test("on-demand app search bounds context and retained memory for 1000 features", async () => {
  const entries = Array.from({ length: 1000 }, (_, index) => ({
    ...FEATURE_CATALOG[index % FEATURE_CATALOG.length],
    id: `feature-${index}`,
  }));
  let output = "";
  searchAppFeatures("SQL formatieren", {}, entries);
  Bun.gc(true);
  const before = heapSize();
  const timing = await measureScenario(() => {
    output = searchAppFeatures("SQL formatieren", {}, entries);
  }, 40);
  Bun.gc(true);
  const retainedBytes = Math.max(0, heapSize() - before);
  expect(timing.p95Ms).toBeLessThan(120);
  expect(output.length).toBeLessThanOrEqual(APP_FEATURE_CHARS);
  expect(JSON.parse(output).length).toBeLessThanOrEqual(5);
  expect(retainedBytes).toBeLessThan(8 * 1024 * 1024);
  await reportScenario("ai-app-companion", {
    workload: { features: entries.length, runs: 40 },
    ...timing,
    retainedBytes,
    outputChars: output.length,
    limits: { p95Ms: 120, retainedBytes: 8 * 1024 * 1024, outputChars: APP_FEATURE_CHARS },
    environment: {
      os: platform(),
      arch: arch(),
      cpu: cpus()[0]?.model,
      ram: totalmem(),
      runtime: Bun.version,
    },
    coverage:
      "Local feature search only; no database, DOM or model calls. HTTP cache/concurrency, cancellation and idle behavior are covered by ai::app_docs tests.",
  });
});
