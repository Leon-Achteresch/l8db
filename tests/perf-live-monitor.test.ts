import { expect, test } from "bun:test";
import { arch, cpus, platform, release, totalmem } from "node:os";
import { liveChartRows } from "../src/features/monitor/live-monitor/live-chart-metrics";
import {
  EMPTY_LIVE_SERIES,
  LIVE_DETAIL_INTERVAL_MS,
  LIVE_POINT_LIMIT,
  type LiveSeriesState,
  needsDetails,
  pointsInRange,
  reduceLiveSample,
  startLivePolling,
} from "../src/lib/live-monitor";
import { liveMetrics } from "./fixtures/live-metrics";
import { measureScenario, reportScenario } from "./fixtures/usage-performance";

const DAY_OF_SAMPLES = 86_400;

function environment() {
  return {
    os: `${platform()} ${release()}`,
    arch: arch(),
    cpu: cpus()[0]?.model ?? "unknown",
    cores: cpus().length,
    ramGb: Math.round(totalmem() / 1024 ** 3),
    runtime: `bun ${Bun.version}`,
  };
}

function sample(index: number) {
  return {
    at: index * 1000,
    metrics: liveMetrics({
      commits: index * 1400,
      rollbacks: index * 3,
      queries_read: index * 1500,
      queries_write: index * 600,
      queries_other: index * 120,
      rows_read: index * 90_000,
      rows_written: index * 2_000,
      blocks_read: index * 12,
      blocks_hit: index * 40_000,
      cpu_busy: index * 28,
      cpu_total: index * 100,
      database_size_bytes: 2_400_000_000 + index,
      table_io: Array.from({ length: 10 }, (_, table) => ({
        name: `public.table_${table}`,
        heap_read: index,
        heap_hit: index * 10,
        idx_read: index,
        idx_hit: index * 10,
      })),
    }),
  };
}

function retainedDataBytes(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

test("live monitor keeps a day of 1 s samples bounded and fast", async () => {
  let state: LiveSeriesState = EMPTY_LIVE_SERIES;
  let details = 0;
  const started = performance.now();
  for (let index = 0; index < DAY_OF_SAMPLES; index++) {
    const snapshot = sample(index);
    const include = needsDetails(state, "perf", snapshot.at);
    if (include) details++;
    state = reduceLiveSample(state, "perf", snapshot, include);
  }
  const ingestMs = performance.now() - started;
  expect(details).toBe(Math.ceil(DAY_OF_SAMPLES / (LIVE_DETAIL_INTERVAL_MS / 1000)));
  expect(state.points).toHaveLength(LIVE_POINT_LIMIT);
  expect(state.tableIo).toHaveLength(10);
  const retainedBytes = retainedDataBytes(state);

  let next = DAY_OF_SAMPLES;
  const push = await measureScenario(() => {
    for (let index = 0; index < 100; index++) {
      const snapshot = sample(next++);
      state = reduceLiveSample(state, "perf", snapshot, false);
    }
  }, 21);
  const render = await measureScenario(() => {
    const visible = pointsInRange(state.points, next * 1000, 60);
    const rows = liveChartRows(visible, "queries");
    expect(rows.length).toBeLessThanOrEqual(240);
  }, 21);

  const limits = {
    ingestMs: 4000,
    push100MedianMs: 15,
    push100P95Ms: 40,
    renderMedianMs: 4,
    renderP95Ms: 10,
    retainedBytes: 1024 * 1024,
  };
  expect(ingestMs).toBeLessThan(limits.ingestMs);
  expect(push.medianMs).toBeLessThan(limits.push100MedianMs);
  expect(push.p95Ms).toBeLessThan(limits.push100P95Ms);
  expect(render.medianMs).toBeLessThan(limits.renderMedianMs);
  expect(render.p95Ms).toBeLessThan(limits.renderP95Ms);
  expect(state.points).toHaveLength(LIVE_POINT_LIMIT);
  expect(retainedBytes).toBeLessThan(limits.retainedBytes);
  reportScenario("live-monitor-series", {
    ...environment(),
    samples: DAY_OF_SAMPLES,
    retainedPoints: state.points.length,
    detailRequests: details,
    ingestMs: Math.round(ingestMs),
    push100: push,
    chartRender: render,
    retainedBytes,
    limits,
  });
});

test("live monitor polling issues one request per interval and none when idle", async () => {
  const timers: (() => void)[] = [];
  let hidden = false;
  let requests = 0;
  let inFlight = 0;
  let maxInFlight = 0;
  const stop = startLivePolling({
    intervalMs: 5000,
    isHidden: () => hidden,
    poll: async () => {
      requests++;
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 0));
      inFlight--;
    },
    schedule: (callback) => timers.push(callback),
    clear: () => undefined,
  });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 1));
  await settle();
  for (let tick = 1; tick < 360; tick++) {
    if (tick === 120) hidden = true;
    if (tick === 240) hidden = false;
    timers.shift()?.();
    await settle();
  }
  const visibleTicks = 360 - 120;
  expect(requests).toBe(visibleTicks);
  expect(maxInFlight).toBe(1);
  stop();
  const pending = timers.length;
  timers.shift()?.();
  await settle();
  expect(requests).toBe(visibleTicks);
  expect(timers).toHaveLength(0);
  reportScenario("live-monitor-polling", {
    ...environment(),
    simulatedMinutes: 30,
    intervalMs: 5000,
    requests,
    hiddenTicksWithoutRequest: 120,
    maxConcurrentRequests: maxInFlight,
    timersAfterCancel: timers.length,
    pendingBeforeCancel: pending,
    limits: { requests: visibleTicks, maxConcurrentRequests: 1, requestsAfterCancel: 0 },
  });
});
