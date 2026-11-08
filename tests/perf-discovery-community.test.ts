import { heapSize } from "bun:jsc";
import { afterAll, beforeEach, expect, mock, setSystemTime, test } from "bun:test";
import { measureScenario, reportScenario } from "../scripts/performance-report";

mock.module("@tauri-apps/plugin-opener", () => ({ openUrl: async () => {} }));

const host = window as unknown as Record<string, unknown>;
const hadListeners = typeof host.addEventListener === "function";
if (!hadListeners) Object.assign(host, { addEventListener() {}, removeEventListener() {} });
const hadStorage = "localStorage" in globalThis;
if (!hadStorage)
  Object.defineProperty(globalThis, "localStorage", {
    value: host.localStorage,
    configurable: true,
  });

let requests = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (async () => {
  requests++;
  return new Response("", { status: 404 });
}) as unknown as typeof fetch;

const { useSettingsStore } = await import("../src/lib/settings");
const { DEFAULT_DISCOVERY_SETTINGS } = await import("../src/lib/discovery/channels");
const { FEATURE_CATALOG } = await import("../src/lib/discovery/catalog");
const { computeRecap } = await import("../src/lib/discovery/recap/model");
const { MAX_RECAP_DAYS, recordRecapActivity, useRecapStore } = await import(
  "../src/lib/discovery/recap/store"
);
const { parseRoadmap, ROADMAP_MAX_ITEMS } = await import("../src/lib/discovery/roadmap/model");
const { refreshRoadmap } = await import("../src/lib/discovery/roadmap/store");
const { evaluateAchievements, primeAchievements, recordAchievementEvent, useAchievementsStore } =
  await import("../src/lib/discovery/achievements/store");
const { useFeatureUsageStore } = await import("../src/lib/discovery/usage");
const { createUsageStatisticsStore } = await import("../src/lib/usage-statistics");
const { DISCOVERY_HOSTS } = await import("../src/features/discovery/registry");
const { DISCOVER_TABS } = await import("../src/features/discovery/discover-tabs");
const { DISCOVERY_SETTINGS_SLOTS } = await import(
  "../src/features/settings/discovery-settings-slots"
);

const now = new Date(2026, 11, 20, 12).getTime();
const DAY = 86_400_000;
const KINDS = ["postgres", "mysql", "sqlite", "mssql", "oracle", "duckdb", "mongodb", "redis"];
const OPERATIONS = ["query", "user-query", "browse", "export", "connect"];

function heap() {
  Bun.gc(true);
  return heapSize();
}

function statistics(events: number) {
  const store = createUsageStatisticsStore({
    storage: null,
    schedule: () => 0 as never,
    cancel: () => {},
  });
  for (let i = 0; i < events; i++)
    store.record({
      type: "operation",
      operation: OPERATIONS[i % OPERATIONS.length],
      kind: KINDS[i % KINDS.length],
      status: i % 17 === 0 ? "error" : "ok",
      ms: (i * 37) % 90_000,
    });
  store.flush();
  return store.getSnapshot();
}

function usage() {
  return Object.fromEntries(
    FEATURE_CATALOG.map((entry, index) => [
      entry.id,
      { count: 1 + ((index * 13) % 400), first: now - 300 * DAY, last: now - (index % 200) * DAY },
    ]),
  );
}

beforeEach(() => {
  setSystemTime(now);
  useSettingsStore.setState({
    localUsageStats: true,
    discovery: structuredClone(DEFAULT_DISCOVERY_SETTINGS),
  });
});

afterAll(() => {
  setSystemTime();
  globalThis.fetch = realFetch;
  if (!hadStorage) Reflect.deleteProperty(globalThis, "localStorage");
  if (!hadListeners) {
    Reflect.deleteProperty(host, "addEventListener");
    Reflect.deleteProperty(host, "removeEventListener");
  }
});

test("loading every community host, tab and settings slot sends no request", async () => {
  const mine = new Set(["team-tips", "recap", "achievements", "roadmap", "team", "labs"]);
  await Promise.all([
    ...DISCOVERY_HOSTS.filter((entry) => mine.has(entry.id)).map((entry) => entry.load()),
    ...DISCOVER_TABS.filter((tab) => mine.has(tab.id)).map((tab) => tab.load()),
    ...DISCOVERY_SETTINGS_SLOTS.filter((slot) => mine.has(slot.id)).map((slot) => slot.load()),
  ]);
  expect(requests).toBe(0);
  await refreshRoadmap();
  expect(requests).toBe(1);
  await refreshRoadmap();
  expect(requests).toBe(1);
  await reportScenario("discovery-community-startup", {
    requestsBeforeTab: 0,
    requestsAfterTab: 1,
  });
});

test("the recap over 10 000 usage events stays fast and bounded", async () => {
  const stats = statistics(10_000);
  const featureUsage = usage();
  useRecapStore.setState({ days: {}, longest: { year: 0, ms: 0 }, offeredYear: null });
  const before = heap();
  const recordTimes: number[] = [];
  for (let i = 0; i < 10_000; i++) {
    const start = performance.now();
    recordRecapActivity(now - (i % 500) * DAY, (i * 31) % 120_000);
    recordTimes.push(performance.now() - start);
  }
  recordTimes.sort((a, b) => a - b);
  const days = useRecapStore.getState().days;
  expect(Object.keys(days).length).toBeLessThanOrEqual(MAX_RECAP_DAYS);
  const compute = await measureScenario(() => {
    const recap = computeRecap({
      year: 2026,
      statistics: stats,
      usage: featureUsage,
      days,
      longestMs: useRecapStore.getState().longest.ms,
      catalog: FEATURE_CATALOG,
    });
    expect(recap.operations).toBe(10_000);
    expect(recap.topFeatures).toHaveLength(5);
  }, 50);
  const retainedBytes = heap() - before;
  const recordP95 = recordTimes[Math.ceil(recordTimes.length * 0.95) - 1];
  await reportScenario("discovery-recap", {
    events: 10_000,
    catalog: FEATURE_CATALOG.length,
    days: Object.keys(days).length,
    compute,
    recordP95Ms: recordP95,
    retainedBytes,
  });
  expect(compute.p95Ms).toBeLessThan(5);
  expect(recordP95).toBeLessThan(1);
  expect(retainedBytes).toBeLessThan(8 * 1024 * 1024);
});

test("roadmap validation of 5 000 items is rejected or bounded quickly", async () => {
  const items = (count: number) =>
    Array.from({ length: count }, (_, i) => ({
      id: `eintrag-${i}`,
      title: `Titel ${i}`.padEnd(80, "x"),
      summary: "s".repeat(400),
      status: i % 3 === 0 ? "geplant" : i % 3 === 1 ? "in-arbeit" : "erschienen",
      issue: i + 1,
      votes: i,
      eta: "Q1 2027",
    }));
  const five = { schemaVersion: 1, items: items(5000) };
  const thousand = { schemaVersion: 1, items: items(1000) };
  const reject = await measureScenario(() => {
    expect(() => parseRoadmap(five)).toThrow();
  }, 200);
  const bounded = await measureScenario(() => {
    expect(parseRoadmap(thousand).items).toHaveLength(ROADMAP_MAX_ITEMS);
  }, 200);
  await reportScenario("discovery-roadmap-validation", { reject, bounded });
  expect(reject.p95Ms).toBeLessThan(1);
  expect(bounded.p95Ms).toBeLessThan(2);
});

test("achievement evaluation per event stays cheap", async () => {
  useFeatureUsageStore.setState({ usage: usage(), extra: 0 });
  useAchievementsStore.setState({
    unlocked: {},
    counters: {},
    families: [],
    primed: false,
    pending: null,
    summaryCount: 0,
  });
  const prime = performance.now();
  primeAchievements(statistics(10_000));
  const primeMs = performance.now() - prime;
  useAchievementsStore.setState({ unlocked: {}, counters: {}, families: [] });
  const names = [
    "query.executed",
    "table.filtered",
    "export.done",
    "table.opened",
    "query.started",
  ];
  const times: number[] = [];
  for (let i = 0; i < 10_000; i++) {
    const start = performance.now();
    recordAchievementEvent({
      name: names[i % names.length],
      data: { family: KINDS[i % KINDS.length] },
      at: now,
    });
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  const p95 = times[Math.ceil(times.length * 0.95) - 1];
  const median = times[Math.floor(times.length / 2)];
  await reportScenario("discovery-achievements", { events: 10_000, primeMs, median, p95 });
  expect(Object.keys(useAchievementsStore.getState().unlocked).length).toBeGreaterThan(5);
  expect(useAchievementsStore.getState().families.length).toBeLessThanOrEqual(32);
  expect(p95).toBeLessThan(0.2);
  expect(primeMs).toBeLessThan(50);
});

test("the expensive case with every rule locked stays cheap over 10 000 events", async () => {
  const extras = Object.fromEntries(
    Array.from({ length: 256 }, (_, index) => [
      `extra.${index}`,
      { count: 50, first: now - DAY, last: now },
    ]),
  );
  useFeatureUsageStore.setState({ usage: extras, extra: 256 });
  useAchievementsStore.setState({
    unlocked: {},
    counters: {},
    families: [],
    primed: true,
    pending: null,
    summaryCount: 0,
  });
  const before = heap();
  const times: number[] = [];
  for (let i = 0; i < 10_000; i++) {
    if (i % 5 === 0) useAchievementsStore.setState({ counters: {}, families: [] });
    const start = performance.now();
    recordAchievementEvent({ name: "table.filtered", data: { family: null }, at: now });
    evaluateAchievements(now);
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  const p95 = times[Math.ceil(times.length * 0.95) - 1];
  const median = times[Math.floor(times.length / 2)];
  const retainedBytes = heap() - before;
  await reportScenario("discovery-achievements-locked", {
    events: 10_000,
    median,
    p95,
    retainedBytes,
  });
  expect(useAchievementsStore.getState().unlocked).toEqual({});
  expect(p95).toBeLessThan(0.2);
  expect(retainedBytes).toBeLessThan(8 * 1024 * 1024);
});
