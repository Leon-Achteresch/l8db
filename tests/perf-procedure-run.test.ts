import { heapStats } from "bun:jsc";
import { expect, test } from "bun:test";
import type { QueryResult } from "../src/lib/db/types";
import { createProcedureRun } from "../src/lib/procedure-run";
import { measureScenario, reportScenario } from "./fixtures/usage-performance";

test("a wide 1,000-row procedure result stays reference-based and single-flight without idle requests", async () => {
  const result: QueryResult = {
    columns: Array.from({ length: 100 }, (_, index) => `value_${index}`),
    rows: Array.from({ length: 1_000 }, (_, row) =>
      Object.fromEntries(
        Array.from({ length: 100 }, (_, col) => [
          `value_${col}`,
          `${row}:${col}:${"x".repeat(64)}`,
        ]),
      ),
    ),
    rows_affected: null,
    execution_time_ms: 10,
    truncated: true,
  };
  const run = createProcedureRun();
  const scope = {};
  let requests = 0;
  let notifications = 0;
  const stop = run.subscribe(() => notifications++);
  run.setScope(scope);
  const execute = async () => {
    requests++;
    return result;
  };
  const scenario = async () => {
    await run.run(scope, execute);
    const state = run.getSnapshot().state;
    if (state.status !== "success" || state.result !== result)
      throw Error("copied or missing result");
  };
  const timing = await measureScenario(scenario, 21);
  expect(requests).toBe(23);
  const idle = run.getSnapshot();
  const beforeIdle = { requests, notifications };
  await new Promise((resolve) => setTimeout(resolve, 25));
  expect({ requests, notifications }).toEqual(beforeIdle);
  expect(run.getSnapshot()).toBe(idle);
  Bun.gc(true);
  const before = heapStats().heapSize;
  for (let index = 0; index < 50; index++) {
    await scenario();
    run.setScope(null);
    run.setScope(scope);
  }
  Bun.gc(true);
  const retainedBytes = Math.max(0, heapStats().heapSize - before);
  let resolve!: (value: QueryResult) => void;
  const delayed = new Promise<QueryResult>((yes) => {
    resolve = yes;
  });
  const pending = run.run(scope, () => {
    requests++;
    return delayed;
  });
  const abandoned = await measureScenario(() => {
    run.setScope(null);
    run.setScope({});
  }, 21);
  expect(await run.run(run.getSnapshot().scope, execute)).toBe(false);
  resolve(result);
  await pending;
  expect(run.getSnapshot().state.status).toBe("idle");
  expect(requests).toBe(74);
  stop();
  reportScenario("procedure-run", {
    rows: 1_000,
    columns: 100,
    timing,
    abandoned,
    retainedBytes,
    requests,
    maximumConcurrentRequests: 1,
    idleRequests: 0,
    backgroundPolling: false,
    bun: Bun.version,
  });
  expect(timing.medianMs).toBeLessThan(10);
  expect(timing.p95Ms).toBeLessThan(25);
  expect(abandoned.p95Ms).toBeLessThan(10);
  expect(retainedBytes).toBeLessThan(2 * 1024 * 1024);
});
