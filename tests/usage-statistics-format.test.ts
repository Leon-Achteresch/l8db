import { expect, test } from "bun:test";
import {
  formatUsageActivity,
  formatUsageCount,
  formatUsageDate,
  formatUsageLatency,
  summarizeUsageStatistics,
  USAGE_AREA_LIMIT,
  USAGE_OPERATION_LIMIT,
  USAGE_PATH_LIMIT,
} from "../src/features/settings/usage-statistics-format";
import type { UsageStatistics } from "../src/lib/usage-statistics";

function statistics(): UsageStatistics {
  return {
    sessionCount: 2,
    startedAt: 1700000000000,
    updatedAt: 1700000001000,
    views: [
      { view: "query", opens: 3, activeMs: 5000 },
      { view: "home", opens: 8, activeMs: 2000 },
    ],
    transitions: [{ from: "home", to: "query", count: 3 }],
    operations: [
      {
        operation: "query",
        kind: "postgres",
        ok: 10,
        error: 2,
        cancelled: 3,
        totalMs: 3000,
        histogram: [15],
      },
      {
        operation: "browse",
        kind: "sqlite",
        ok: 1,
        error: 1,
        cancelled: 0,
        totalMs: 100,
        histogram: [2],
      },
    ],
    startup: { count: 1, totalMs: 1000, histogram: [1] },
  };
}

test("statistics summarize outcomes and area activity without changing the source", () => {
  const input = statistics();
  const before = JSON.stringify(input);
  const summary = summarizeUsageStatistics(input);
  expect(summary).toMatchObject({
    activeMs: 7000,
    viewOpens: 11,
    operationCount: 17,
    successful: 11,
    errors: 3,
    cancelled: 3,
    hasActivity: true,
  });
  expect(summary.areas.map((area) => area.view)).toEqual(["home", "query"]);
  expect(JSON.stringify(input)).toBe(before);
});

test("statistics presentation bounds every ranked section while preserving full totals", () => {
  const input = statistics();
  input.views = Array.from({ length: 64 }, (_, index) => ({
    view: `area-${index}`,
    opens: index,
    activeMs: 1000,
  }));
  input.transitions = Array.from({ length: 128 }, (_, index) => ({
    from: `area-${index}`,
    to: "query",
    count: index,
  }));
  input.operations = Array.from({ length: 240 }, (_, index) => ({
    operation: `operation-${index}`,
    kind: "postgres",
    ok: index,
    error: 1,
    cancelled: 2,
    totalMs: 10,
    histogram: [index + 3],
  }));
  const summary = summarizeUsageStatistics(input);
  expect(summary.areas).toHaveLength(USAGE_AREA_LIMIT);
  expect(summary.paths).toHaveLength(USAGE_PATH_LIMIT);
  expect(summary.operations).toHaveLength(USAGE_OPERATION_LIMIT);
  expect(summary.areas[0].view).toBe("area-63");
  expect(summary.paths[0].count).toBe(127);
  expect(summary.operations[0].ok).toBe(239);
  expect(summary.activeMs).toBe(64000);
  expect(summary.operationCount).toBe(29400);
});

test("empty statistics and latency overflow are represented without invented measurements", () => {
  const input = statistics();
  input.views = [];
  input.transitions = [];
  input.operations = [];
  input.startup = { count: 0, totalMs: 0, histogram: [] };
  expect(summarizeUsageStatistics(input).hasActivity).toBe(false);
  expect(formatUsageLatency(0)).toBe("–");
  expect(formatUsageLatency(Number.NaN)).toBe("–");
  expect(formatUsageLatency(250)).toBe("250 ms");
  expect(formatUsageLatency(2500)).toBe("2,5 s");
  expect(formatUsageLatency(86400000)).toBe("> 5 Min.");
  expect(formatUsageActivity(59999)).toBe("59 Sek.");
  expect(formatUsageActivity(3599999)).toBe("59 Min.");
  expect(formatUsageActivity(3660000)).toBe("1 Std. 1 Min.");
  expect(formatUsageDate(null)).toBe("–");
  expect(formatUsageCount(1000)).toBe("1.000");
});
