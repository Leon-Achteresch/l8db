import { expect, test } from "bun:test";
import { measureScenario, reportScenario } from "../scripts/performance-report";
import {
  ACTIVITY_POINT_LIMIT,
  ACTIVITY_RANGE_MS,
  RECENT_LIMIT,
  selectActivity,
} from "../src/features/home/activity";
import type { QueryHistoryEntry } from "../src/lib/query-history";

const NOW = Date.UTC(2026, 9, 25, 12);

function entry(index: number, overrides: Partial<QueryHistoryEntry> = {}): QueryHistoryEntry {
  return {
    id: `e${index}`,
    connectionId: index % 3 === 0 ? "other" : "conn",
    database: "db",
    sql: `SELECT ${index} ${"x".repeat(4000)}`,
    ranAt: NOW - index * 60_000,
    durationMs: 5 + (index % 900),
    rowCount: index,
    error: index % 17 === 0 ? "boom" : null,
    ...overrides,
  };
}

test("Aktivität filtert nach Verbindung und Datenbank und skaliert Punkte in den Zeitraum", () => {
  const history = [
    entry(1, { durationMs: 1000 }),
    entry(2, { database: "other" }),
    entry(4, { durationMs: null, error: "fail" }),
    entry(5, { ranAt: NOW - ACTIVITY_RANGE_MS - 1 }),
  ];
  const activity = selectActivity(history, "conn", "db", NOW);
  expect(activity.recent.map((item) => item.id)).toEqual(["e1", "e4", "e5"]);
  expect(activity.points.map((point) => point.id)).toEqual(["e1", "e4"]);
  expect(activity.points[0].y).toBe(1);
  expect(activity.points[1]).toMatchObject({ y: 0, error: true });
  for (const point of activity.points) expect(point.x).toBeGreaterThan(0.99);
  expect(activity.days.length).toBeGreaterThanOrEqual(7);
  for (const day of activity.days) expect(day.x).toBeGreaterThan(0);
  expect(selectActivity([], "conn", "db", NOW).points).toEqual([]);
});

test("eine volle Historie bleibt bei Punkten und Laufzeit begrenzt", async () => {
  const history = Array.from({ length: 5000 }, (_, index) =>
    entry(index, { ranAt: NOW - index * 20_000 }),
  );
  let result = selectActivity(history, "conn", "db", NOW);
  const timing = await measureScenario(() => {
    for (let run = 0; run < 20; run++) result = selectActivity(history, "conn", "db", NOW);
  });
  expect(result.recent).toHaveLength(RECENT_LIMIT);
  expect(result.points).toHaveLength(ACTIVITY_POINT_LIMIT);
  for (const point of result.points) expect(point.label.length).toBeLessThanOrEqual(140);
  expect(timing.p95Ms).toBeLessThan(40);
  await reportScenario("home-activity-timeline", {
    ...timing,
    historyEntries: history.length,
    runsPerSample: 20,
    points: result.points.length,
    recent: result.recent.length,
  });
});
