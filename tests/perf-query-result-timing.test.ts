import { heapStats } from "bun:jsc";
import { expect, test } from "bun:test";
import { arch, cpus, platform, release, totalmem } from "node:os";
import { buildStatusText } from "../src/features/query/query-view/result-text";
import { queryTimingDescription, withAdapterResultTiming } from "../src/lib/query-result-timing";
import { measureScenario, reportScenario } from "./fixtures/usage-performance";

test("timing annotations and status updates never traverse a large result or start background requests", async () => {
  let rowReads = 0;
  const rows = new Proxy(Array<Record<string, unknown>>(100_000), {
    get(target, key, receiver) {
      if (typeof key === "string" && /^\d+$/.test(key)) {
        rowReads++;
        throw Error("timing must not materialize rows");
      }
      return Reflect.get(target, key, receiver);
    },
  });
  const result = { columns: ["payload"], rows, rows_affected: null, execution_time_ms: 123 };
  const run = () => {
    for (let index = 0; index < 10_000; index++) {
      const timed = withAdapterResultTiming(result, "postgres");
      if (
        timed.rows !== rows ||
        !buildStatusText(timed)?.endsWith("123 ms inkl. Ergebnisübernahme")
      )
        throw Error("invalid status");
      queryTimingDescription(timed);
    }
  };
  const times = await measureScenario(run, 9);
  Bun.gc(true);
  const before = heapStats().heapSize;
  for (let round = 0; round < 5; round++) run();
  Bun.gc(true);
  const retainedBytes = Math.max(0, heapStats().heapSize - before);
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(rowReads).toBe(0);
  reportScenario("query-result-timing", {
    resultRows: rows.length,
    statusUpdates: 10_000,
    ...times,
    retainedBytes,
    rowReads,
    requests: 0,
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
