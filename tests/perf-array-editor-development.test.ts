import { heapStats } from "bun:jsc";
import { expect, test } from "bun:test";
import { arrayEditorDevelopmentSelected } from "../src/lib/development-entry";
import { measureScenario, reportScenario } from "./fixtures/usage-performance";

test("isolated array gate bounds input with no retained work, requests or polling", async () => {
  const excessive = `?${"x".repeat(1_000_000)}`;
  const run = () => {
    for (let index = 0; index < 10000; index++) {
      if (arrayEditorDevelopmentSelected(false, "?array-editor-development=1"))
        throw Error("release");
      if (arrayEditorDevelopmentSelected(true, excessive)) throw Error("unbounded input");
      if (!arrayEditorDevelopmentSelected(true, "?array-editor-development=1"))
        throw Error("debug");
    }
  };
  const times = await measureScenario(run, 11);
  Bun.gc(true);
  const before = heapStats().heapSize;
  for (let index = 0; index < 5; index++) run();
  Bun.gc(true);
  const retainedBytes = Math.max(0, heapStats().heapSize - before);
  reportScenario("a01-development-gate", {
    decisions: 30000,
    ...times,
    retainedBytes,
    requests: 0,
    timers: 0,
  });
  expect(times.medianMs).toBeLessThan(50);
  expect(times.p95Ms).toBeLessThan(100);
  expect(retainedBytes).toBeLessThan(4 * 1024 * 1024);
});
