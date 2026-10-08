import { expect, test } from "bun:test";

import {
  alignComparison,
  buildComparison,
  summarize,
} from "../src/features/dashboard/charts/chart-summary";
import {
  comparisonRange,
  type DatasetShape,
  DEFAULT_OPTIONS,
  fmtCompact,
  fmtDim,
  periodProgress,
  periodRange,
} from "../src/lib/dashboards";

const NOW = new Date(2026, 9, 8);
const SHAPE: DatasetShape = {
  dimension: "dim",
  dimension2: null,
  metrics: [{ key: "m0", label: "Umsatz" }],
  hasDate: true,
};

test("comparison ranges cover the equally long window before or a year earlier", () => {
  expect(periodRange("30d", NOW)).toEqual({ start: "2026-09-08", end: null });
  expect(comparisonRange("30d", "previous", NOW)).toEqual({
    start: "2026-08-08",
    end: "2026-09-08",
  });
  expect(comparisonRange("7d", "previous", NOW)).toEqual({
    start: "2026-09-23",
    end: "2026-10-01",
  });
  expect(comparisonRange("quarter", "previous", NOW)).toEqual({
    start: "2026-07-01",
    end: "2026-07-09",
  });
  expect(comparisonRange("year", "year", NOW)).toEqual({ start: "2025-01-01", end: "2025-10-09" });
  expect(comparisonRange("12m", "previous", NOW)).toEqual({
    start: "2024-11-01",
    end: "2025-10-09",
  });
  expect(comparisonRange("all", "previous", NOW)).toBeNull();
  expect(comparisonRange("30d", "none", NOW)).toBeNull();
});

test("pace only exists for calendar periods", () => {
  expect(periodProgress("year", new Date(2026, 6, 2))).toBeCloseTo(0.5, 1);
  expect(periodProgress("30d", NOW)).toBeNull();
});

test("time series align right to left, categories by label", () => {
  const rows = [{ dim: "2026-08" }, { dim: "2026-09" }, { dim: "2026-10" }];
  const before = [
    { dim: "2025-09", m0: 1 },
    { dim: "2025-10", m0: 2 },
  ];
  expect(alignComparison(rows, before, SHAPE)).toEqual([{}, before[0], before[1]]);
  const cats = [{ dim: "B" }, { dim: "A" }];
  expect(alignComparison(cats, [{ dim: "A", m0: 5 }], SHAPE)).toEqual([{}, { dim: "A", m0: 5 }]);
  const compare = buildComparison("line", rows, before, SHAPE, DEFAULT_OPTIONS, "ggü.", "Vj.");
  expect(compare?.values).toEqual([null, 1, 2]);
});

test("headline totals the period and compares it with the previous one", () => {
  const rows = [
    { dim: "2026-09", m0: 60 },
    { dim: "2026-10", m0: 50 },
  ];
  const base = {
    kind: "area" as const,
    shape: SHAPE,
    options: DEFAULT_OPTIONS,
    current: { rows },
    previousLabel: "ggü. Vorjahr",
    stepLabel: "ggü. Vormonat",
    aggOf: () => "sum" as const,
  };
  const summary = summarize({ ...base, previous: { rows: [{ dim: "2025-10", m0: 100 }] } });
  expect(summary.value).toBe(110);
  expect(summary.delta).toBeCloseTo(10);
  expect(summary.good).toBe(true);
  expect(
    summarize({
      ...base,
      options: { ...DEFAULT_OPTIONS, invertDelta: true },
      previous: { rows: [{ m0: 100 }] },
    }).good,
  ).toBe(false);
  const kpi = summarize({ ...base, kind: "kpi", previous: { rows: [{ m0: 100 }] } });
  expect(kpi.value).toBe(50);
  expect(kpi.delta).toBeCloseTo(-16.67, 1);
  expect(kpi.deltaLabel).toBe("ggü. Vormonat");
  const avg = summarize({ ...base, previous: null, aggOf: () => "avg" });
  expect(avg.value).toBe(55);
  const totals = summarize({ ...base, previous: null, current: { rows, totals: { m0: 42 } } });
  expect(totals.value).toBe(42);
});

test("german number and date labels", () => {
  expect(fmtCompact(1_240_000)).toBe("1,2 Mio.");
  expect(fmtCompact(48_200)).toBe("48,2 Tsd.");
  expect(fmtDim("2025-11", "month", true)).toBe("Nov ’25");
  expect(fmtDim("2026-03-04", "day")).toBe("4. Mär");
});
