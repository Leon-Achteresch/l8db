import { heapStats } from "bun:jsc";
import { expect, test } from "bun:test";
import { csvCheckDevelopmentSelected } from "../src/lib/development-entry";
import { measureScenario, reportScenario } from "./fixtures/usage-performance";

test("10000 development gate decisions keep no state, requests or background work", async () => {
  const run = () => {
    for (let index = 0; index < 10000; index++) {
      if (csvCheckDevelopmentSelected(false, "?csv-check-development=1"))
        throw Error("release gate opened");
      if (!csvCheckDevelopmentSelected(true, "?csv-check-development=1"))
        throw Error("development gate closed");
    }
  };
  const times = await measureScenario(run, 11);
  Bun.gc(true);
  const before = heapStats().heapSize;
  for (let index = 0; index < 5; index++) run();
  Bun.gc(true);
  const retainedBytes = Math.max(0, heapStats().heapSize - before);
  reportScenario("csv-development-gate", {
    decisions: 20000,
    ...times,
    retainedBytes,
    nativeRequests: 0,
    dbRequests: 0,
    timers: 0,
    bun: Bun.version,
  });
  expect(times.medianMs).toBeLessThan(50);
  expect(times.p95Ms).toBeLessThan(100);
  expect(retainedBytes).toBeLessThan(4 * 1024 * 1024);
});
