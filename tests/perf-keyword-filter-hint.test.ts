import { heapStats } from "bun:jsc";
import { expect, test } from "bun:test";
import { arch, cpus, platform, release, totalmem } from "node:os";
import type { DetailedColumnInfo } from "../src/lib/db";
import { keywordFilterHint } from "../src/lib/keyword-filter-hint";
import { measureScenario, reportScenario } from "./fixtures/usage-performance";

test("10,000 keyword-hint updates remain local, bounded and idle without requests", async () => {
  const column: DetailedColumnInfo = {
    name: "message",
    data_type: "text",
    is_nullable: true,
    column_default: null,
    is_primary_key: false,
    ordinal_position: 1,
    character_maximum_length: null,
    exact_filter: {
      target: "message.keyword",
      strategy: "keyword",
      ignore_above: { state: "configured", value: 256 },
      scope: "single_index",
      index_mode: "unverified",
    },
  };
  const run = () => {
    for (let index = 0; index < 10_000; index++) {
      const hint = keywordFilterHint("elasticsearch", column, index % 2 ? "eq" : "neq");
      if (!hint?.summary.endsWith("ignore_above=256")) throw new Error("wrong mapping hint");
    }
  };
  const times = await measureScenario(run, 9);
  Bun.gc(true);
  const before = heapStats().heapSize;
  for (let index = 0; index < 5; index++) run();
  Bun.gc(true);
  const retainedBytes = Math.max(0, heapStats().heapSize - before);
  await new Promise((resolve) => setTimeout(resolve, 20));
  reportScenario("keyword-filter-hint", {
    updates: 10_000,
    ...times,
    retainedBytes,
    dbRequests: 0,
    backgroundWorkers: 0,
    environment: {
      os: platform(),
      release: release(),
      arch: arch(),
      cpu: cpus()[0]?.model,
      ramBytes: totalmem(),
      bun: Bun.version,
    },
  });
  expect(times.medianMs).toBeLessThan(50);
  expect(times.p95Ms).toBeLessThan(100);
  expect(retainedBytes).toBeLessThan(4 * 1024 * 1024);
});
