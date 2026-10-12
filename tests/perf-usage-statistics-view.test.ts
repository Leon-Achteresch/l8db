import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsUsageAreas } from "../src/features/settings/settings-usage-areas";
import { SettingsUsageOperations } from "../src/features/settings/settings-usage-operations";
import { summarizeUsageStatistics } from "../src/features/settings/usage-statistics-format";
import type { UsageStatistics } from "../src/lib/usage-statistics";
import { measureScenario, reportScenario } from "./fixtures/usage-performance";

test("large retained statistics produce bounded ranking and table output", async () => {
  const histogram = [10, 10, 20, 20, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const statistics: UsageStatistics = {
    sessionCount: 32,
    startedAt: 1700000000000,
    updatedAt: 1700000001000,
    views: Array.from({ length: 64 }, (_, index) => ({
      view: "query",
      opens: index + 1,
      activeMs: 60000,
    })),
    transitions: Array.from({ length: 128 }, (_, index) => ({
      from: "home",
      to: "query",
      count: index + 1,
    })),
    operations: Array.from({ length: 240 }, (_, index) => ({
      operation: "query",
      kind: "postgres",
      ok: index + 1,
      error: 2,
      cancelled: 3,
      totalMs: 1000,
      histogram,
    })),
    startup: { count: 32, totalMs: 32000, histogram },
  };
  let summary = summarizeUsageStatistics(statistics);
  const timing = await measureScenario(() => {
    for (let index = 0; index < 100; index++) summary = summarizeUsageStatistics(statistics);
  });
  const areas = renderToStaticMarkup(createElement(SettingsUsageAreas, { summary }));
  const operations = renderToStaticMarkup(
    createElement(SettingsUsageOperations, { summary, startup: statistics.startup }),
  );
  expect(areas.match(/<li\b/g)).toHaveLength(16);
  expect(operations.match(/<tr\b/g)).toHaveLength(17);
  expect(areas.length + operations.length).toBeLessThan(30000);
  expect(operations).toContain("10 ms");
  expect(operations).toContain("25 ms");
  expect(timing.medianMs).toBeLessThan(15);
  expect(timing.p95Ms).toBeLessThan(30);
  await reportScenario("usage-statistics-view", {
    ...timing,
    retainedWindowSessions: 32,
    viewGroups: 64,
    transitionGroups: 128,
    operationGroups: 240,
    summariesPerRun: 100,
    renderedListRows: 16,
    renderedOperationRows: 16,
    renderedBytes: areas.length + operations.length,
    databaseRequests: 0,
    pollingTimers: 0,
    medianBudgetMs: 15,
    p95BudgetMs: 30,
  });
});
