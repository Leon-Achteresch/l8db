import { expect } from "bun:test";
import type { Page } from "playwright";

type InspectorSession = {
  send: (method: string, parameters?: Record<string, unknown>) => Promise<unknown>;
  on: (event: string, listener: (data: unknown) => void) => void;
};

export async function profileWebKit(page: Page, path: string) {
  const connection = (
    page as unknown as {
      _connection: { toImpl: (page: Page) => { delegate: { _session: InspectorSession } } };
    }
  )._connection;
  const session = connection.toImpl(page).delegate._session;
  const timeline: unknown[] = [];
  const collections: unknown[] = [];
  const scripts: unknown[] = [];
  let samples: unknown;
  session.on("Timeline.eventRecorded", (event) => timeline.push(event));
  session.on("Heap.garbageCollected", (event) => collections.push(event));
  session.on("ScriptProfiler.trackingUpdate", (event) => scripts.push(event));
  session.on("ScriptProfiler.trackingComplete", (event) => {
    samples = event;
  });
  await session.send("Timeline.enable");
  await session.send("Heap.enable");
  await session.send("ScriptProfiler.startTracking", { includeSamples: true });
  await session.send("Timeline.start", { maxCallStackDepth: 0 });
  return async () => {
    await session.send("Timeline.stop");
    await session.send("ScriptProfiler.stopTracking");
    await Bun.write(path, JSON.stringify({ timeline, collections, scripts, samples }));
  };
}

export const FRAME_BUDGETS =
  process.env.L8DB_PERF_ENGINE === "webkit" ? "informational" : "enforced";

function reportFrame(value: number) {
  expect(value).toBeGreaterThan(0);
  const site = new Error().stack?.split("\n").find((line) => line.includes(".test.ts"));
  const report = (met: boolean, limit: string) => {
    if (!met)
      console.log(`WebKit frame budget missed (informational): ${value} ${limit} ${site?.trim()}`);
  };
  return {
    toBeGreaterThan: (limit: number) => report(value > limit, `<= ${limit}`),
    toBeLessThan: (limit: number) => report(value < limit, `>= ${limit}`),
  };
}

export const expectFrame: (value: number) => ReturnType<typeof reportFrame> =
  FRAME_BUDGETS === "enforced" ? expect : reportFrame;
