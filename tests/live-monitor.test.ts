import { describe, expect, test } from "bun:test";
import {
  ACTIVITY_METRICS,
  liveChartRows,
} from "../src/features/monitor/live-monitor/live-chart-metrics";
import { tokenizeSqlLine } from "../src/features/monitor/live-monitor/sql-tokens";
import {
  appendPoint,
  cpuPercent,
  EMPTY_LIVE_SERIES,
  percentChange,
  pointsInRange,
  reduceLiveSample,
  startLivePolling,
} from "../src/lib/live-monitor";
import { liveMetrics } from "./fixtures/live-metrics";

describe("live monitor series", () => {
  test("derives per-second rates from cumulative counters", () => {
    let state = reduceLiveSample(EMPTY_LIVE_SERIES, "a", { at: 0, metrics: liveMetrics() }, true);
    expect(state.points).toHaveLength(0);
    state = reduceLiveSample(
      state,
      "a",
      {
        at: 2000,
        metrics: liveMetrics({
          commits: 2000,
          rollbacks: 20,
          queries_read: 3000,
          queries_write: 1000,
          queries_other: 200,
          blocks_hit: 400,
          blocks_read: 4,
          cpu_busy: 30,
          cpu_total: 100,
        }),
      },
      false,
    );
    const [point] = state.points;
    expect(point.tps).toBe(1010);
    expect(point.rollbacks).toBe(10);
    expect(point.queriesRead).toBe(1500);
    expect(point.queriesWrite).toBe(500);
    expect(point.queriesOther).toBe(100);
    expect(point.blocksHit).toBe(200);
    expect(point.cpu).toBeNull();
  });

  test("clamps counter resets, keeps size between detail samples and resets on key change", () => {
    let state = reduceLiveSample(
      EMPTY_LIVE_SERIES,
      "a",
      { at: 0, metrics: liveMetrics({ commits: 500, database_size_bytes: 1000 }) },
      true,
    );
    state = reduceLiveSample(
      state,
      "a",
      { at: 1000, metrics: liveMetrics({ commits: 10 }) },
      false,
    );
    expect(state.points[0].tps).toBe(0);
    expect(state.points[0].sizeBytes).toBe(1000);
    expect(state.sizeBytes).toBe(1000);
    const other = reduceLiveSample(state, "b", { at: 2000, metrics: liveMetrics() }, false);
    expect(other.points).toHaveLength(0);
    expect(other.sizeBytes).toBeNull();
    const stale = reduceLiveSample(state, "a", { at: 500, metrics: liveMetrics() }, false);
    expect(stale.points).toHaveLength(1);
  });

  test("computes cpu usage from proc/stat deltas", () => {
    expect(
      cpuPercent(
        liveMetrics({ cpu_busy: 100, cpu_total: 1000 }),
        liveMetrics({ cpu_busy: 128, cpu_total: 1100 }),
      ),
    ).toBeCloseTo(28);
    expect(cpuPercent(liveMetrics(), liveMetrics({ cpu_busy: 1, cpu_total: 2 }))).toBeNull();
  });

  test("bounds the ring buffer and filters by time range", () => {
    let points = EMPTY_LIVE_SERIES.points;
    const base = reduceLiveSample(EMPTY_LIVE_SERIES, "a", { at: 0, metrics: liveMetrics() }, true);
    for (let index = 1; index <= 50; index++) {
      const next = reduceLiveSample(
        base,
        "a",
        { at: index * 60_000, metrics: liveMetrics() },
        false,
      );
      points = appendPoint(points, { ...next.points[0], at: index * 60_000 }, 20);
    }
    expect(points).toHaveLength(20);
    expect(points[0].at).toBe(31 * 60_000);
    expect(pointsInRange(points, 50 * 60_000, 5).map((point) => point.at / 60_000)).toEqual([
      45, 46, 47, 48, 49, 50,
    ]);
  });

  test("reports relative changes", () => {
    expect(percentChange(1482, 1323)).toBeCloseTo(12.02, 1);
    expect(percentChange(5, 0)).toBeNull();
    expect(percentChange(null, 1)).toBeNull();
  });
});

describe("live monitor chart", () => {
  test("averages buckets so the chart stays bounded", () => {
    const base = reduceLiveSample(EMPTY_LIVE_SERIES, "a", { at: 0, metrics: liveMetrics() }, true);
    const point = reduceLiveSample(
      base,
      "a",
      { at: 1000, metrics: liveMetrics({ commits: 10 }) },
      false,
    ).points[0];
    const points = Array.from({ length: 1000 }, (_, index) => ({
      ...point,
      at: index,
      commits: index % 2 ? 10 : 20,
    }));
    const rows = liveChartRows(points, "transactions", 100);
    expect(rows).toHaveLength(100);
    expect(rows[0].a).toBe(15);
    expect(ACTIVITY_METRICS).toContain("queries");
  });

  test("highlights SQL keywords and literals", () => {
    expect(tokenizeSqlLine("WHERE o.status = 'open' LIMIT 100")).toEqual([
      { text: "WHERE", kind: "keyword" },
      { text: " ", kind: "plain" },
      { text: "o", kind: "plain" },
      { text: ".", kind: "plain" },
      { text: "status", kind: "plain" },
      { text: " = ", kind: "plain" },
      { text: "'open'", kind: "string" },
      { text: " ", kind: "plain" },
      { text: "LIMIT", kind: "keyword" },
      { text: " ", kind: "plain" },
      { text: "100", kind: "number" },
    ]);
  });
});

describe("live monitor polling", () => {
  test("never overlaps requests, skips hidden windows and stops on cancel", async () => {
    const timers: (() => void)[] = [];
    let hidden = false;
    let inFlight = 0;
    let maxInFlight = 0;
    let requests = 0;
    const stop = startLivePolling({
      intervalMs: 5000,
      isHidden: () => hidden,
      poll: async () => {
        requests++;
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await Promise.resolve();
        inFlight--;
      },
      schedule: (callback) => timers.push(callback),
      clear: () => undefined,
    });
    const flush = async () => {
      for (let index = 0; index < 5; index++) await Promise.resolve();
    };
    await flush();
    expect(requests).toBe(1);
    timers.shift()?.();
    await flush();
    expect(requests).toBe(2);
    hidden = true;
    timers.shift()?.();
    await flush();
    expect(requests).toBe(2);
    expect(timers).toHaveLength(1);
    stop();
    timers.shift()?.();
    await flush();
    expect(requests).toBe(2);
    expect(timers).toHaveLength(0);
    expect(maxInFlight).toBe(1);
  });
});
