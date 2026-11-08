import { afterAll, beforeEach, describe, expect, mock, setSystemTime, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const opened: string[] = [];
mock.module("@tauri-apps/plugin-opener", () => ({
  openUrl: async (url: string) => {
    opened.push(url);
  },
}));

let teamPayload: unknown = { path: "/x/.l8db/connections.json", exists: true, connections: [] };
mock.module("@tauri-apps/api/core", () => ({
  transformCallback: () => 1,
  invoke: async (command: string) => (command === "team_connections" ? teamPayload : null),
}));

const host = window as unknown as Record<string, unknown>;
const hadStorage = "localStorage" in globalThis;
if (!hadStorage)
  Object.defineProperty(globalThis, "localStorage", {
    value: host.localStorage,
    configurable: true,
  });
const hadListeners = typeof host.addEventListener === "function";
if (!hadListeners) Object.assign(host, { addEventListener() {}, removeEventListener() {} });

const { useSettingsStore } = await import("../src/lib/settings");
const { DEFAULT_DISCOVERY_SETTINGS } = await import("../src/lib/discovery/channels");
const { LABS, labEnabled, labFeedbackUrl, setLab } = await import("../src/lib/discovery/labs/labs");
const { parseRoadmap, parseRoadmapRelease, ROADMAP_CACHE_MS, ROADMAP_MAX_RAW_ITEMS } = await import(
  "../src/lib/discovery/roadmap/model"
);
const { cachedRoadmap, refreshRoadmap, useRoadmapStore } = await import(
  "../src/lib/discovery/roadmap/store"
);
const { activeTeamTips, MAX_TEAM_TIPS, parseTeamTips } = await import("../src/lib/team/tips");
const { nextTeamTip, useTeamTipsStore } = await import("../src/lib/discovery/team-tips/store");
const { syncTeam } = await import("../src/lib/team/sync");
const { useTeamStore } = await import("../src/lib/team/store");
const { computeRecap, recapYear } = await import("../src/lib/discovery/recap/model");
const { recordRecapActivity, useRecapStore } = await import("../src/lib/discovery/recap/store");
const { FEATURE_CATALOG, featureById } = await import("../src/lib/discovery/catalog");
const { ACHIEVEMENTS } = await import("../src/lib/discovery/achievements/rules");
const {
  ACHIEVEMENT_SUMMARY,
  evaluateAchievements,
  primeAchievements,
  recordAchievementEvent,
  useAchievementsStore,
} = await import("../src/lib/discovery/achievements/store");
const { useFeatureUsageStore } = await import("../src/lib/discovery/usage");
const { DiscoverRecapTab } = await import("../src/features/discovery/recap/discover-recap-tab");
const { createUsageStatisticsStore } = await import("../src/lib/usage-statistics");
const { DISCOVER_TABS, visibleDiscoverTabs } = await import(
  "../src/features/discovery/discover-tabs"
);
const { NEW_FEATURES } = await import("../src/lib/new-features");

const now = new Date(2026, 10, 8, 12).getTime();
const realFetch = globalThis.fetch;

function release(body: unknown, tag = "roadmap") {
  return JSON.stringify({ tag_name: tag, draft: false, body: JSON.stringify(body) });
}
const item = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  title: `Titel ${id}`,
  summary: "Kurz",
  status: "geplant",
  ...extra,
});

function emptyStatistics() {
  return createUsageStatisticsStore({
    storage: null,
    schedule: () => 0 as never,
    cancel: () => {},
  }).getSnapshot();
}

beforeEach(() => {
  setSystemTime(now);
  opened.length = 0;
  useSettingsStore.setState({
    discovery: structuredClone(DEFAULT_DISCOVERY_SETTINGS),
    updateChannel: "stable",
    localUsageStats: true,
  });
  useRoadmapStore.setState({ feed: null, fetchedAt: 0, checkedAt: 0, loading: false, error: null });
  useFeatureUsageStore.setState({ usage: {}, extra: 0 });
  useAchievementsStore.setState({
    unlocked: {},
    counters: {},
    families: [],
    primed: false,
    pending: null,
    summaryCount: 0,
  });
  useRecapStore.setState({ days: {}, longest: { year: 0, ms: 0 }, offeredYear: null });
  useTeamTipsStore.setState({ seen: {} });
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

describe("labs", () => {
  test("only real switches are offered and every one mirrors an existing setting", () => {
    expect(LABS.map((lab) => lab.id)).toEqual(["canary-updates", "achievements"]);
    const state = useSettingsStore.getState() as unknown as Record<string, unknown>;
    for (const lab of LABS) {
      expect(lab.mirror).toBeDefined();
      expect(state[lab.mirror?.settingKey as string]).toBeDefined();
      if (lab.featureId) expect(featureById(lab.featureId)).toBeDefined();
    }
  });

  test("labs mirror the update channel and the achievements channel without duplicates", () => {
    expect(labEnabled("canary-updates")).toBe(false);
    useSettingsStore.getState().setUpdateChannel("canary");
    expect(labEnabled("canary-updates")).toBe(true);
    setLab("canary-updates", false);
    expect(useSettingsStore.getState().updateChannel).toBe("stable");
    expect(labEnabled("achievements")).toBe(false);
    setLab("achievements", true);
    expect(useSettingsStore.getState().discovery.channels.achievements).toBe(true);
    expect(labEnabled("achievements")).toBe(true);
    expect(useSettingsStore.getState().discovery.labs).toEqual({});
    expect(labEnabled("unbekannt")).toBe(false);
  });

  test("feedback opens a prefilled GitHub issue", () => {
    const url = new URL(labFeedbackUrl(LABS[0], "0.18.0"));
    expect(url.href.startsWith("https://github.com/Leon-Achteresch/l8db/issues/new?")).toBe(true);
    expect(url.searchParams.get("title")).toBe("Labs: Canary-Updates");
    expect(url.searchParams.get("body")).toContain("l8db 0.18.0");
  });
});

describe("roadmap feed", () => {
  test("validates every field and drops broken items", () => {
    const feed = parseRoadmap({
      schemaVersion: 1,
      items: [
        item("a", { issue: 12, votes: 3, eta: "Q1" }),
        item("a"),
        item("b", { status: "fertig" }),
        item("c", { issue: "12" }),
        item("d", { votes: -1 }),
        item("e", { title: "" }),
        item("F"),
        item("g", { summary: "x".repeat(401) }),
        "kaputt",
        item("h", { status: "erschienen" }),
      ],
    });
    expect(feed.items.map((entry) => entry.id)).toEqual(["a", "h"]);
    expect(feed.items[0]).toEqual({
      id: "a",
      title: "Titel a",
      summary: "Kurz",
      status: "geplant",
      issue: 12,
      votes: 3,
      eta: "Q1",
    });
  });

  test("rejects broken JSON, wrong schema versions, wrong types and oversized feeds", () => {
    expect(() => parseRoadmapRelease("{kaputt")).toThrow();
    expect(() => parseRoadmapRelease(JSON.stringify({ tag_name: "roadmap", body: "{" }))).toThrow();
    expect(() => parseRoadmapRelease(release({ schemaVersion: 1, items: [] }, "x"))).toThrow();
    expect(() => parseRoadmap({ schemaVersion: 2, items: [] })).toThrow();
    expect(() => parseRoadmap({ schemaVersion: "1", items: [] })).toThrow();
    expect(() => parseRoadmap({ schemaVersion: 1, items: {} })).toThrow();
    expect(() => parseRoadmap([])).toThrow();
    const many = Array.from({ length: ROADMAP_MAX_RAW_ITEMS + 1 }, (_, i) => item(`i${i}`));
    expect(() => parseRoadmap({ schemaVersion: 1, items: many })).toThrow();
    expect(parseRoadmap({ schemaVersion: 1, items: many.slice(0, 500) }).items).toHaveLength(100);
    const fenced = JSON.stringify({
      tag_name: "roadmap",
      body: `\`\`\`json\n${JSON.stringify({ schemaVersion: 1, items: [item("z")] })}\n\`\`\``,
    });
    expect(parseRoadmapRelease(fenced).items[0]?.id).toBe("z");
  });

  test("fetches lazily, caches, honours the 6 h interval and the 1/min manual limit", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response(release({ schemaVersion: 1, items: [item("a")] }));
    }) as unknown as typeof fetch;
    expect(calls).toBe(0);
    expect(await refreshRoadmap()).toBe(true);
    expect(calls).toBe(1);
    expect(cachedRoadmap()?.items).toHaveLength(1);
    expect(await refreshRoadmap()).toBe(false);
    expect(await refreshRoadmap(true)).toBe(false);
    setSystemTime(now + 61_000);
    expect(await refreshRoadmap(true)).toBe(true);
    expect(calls).toBe(2);
    setSystemTime(now + 61_000 + 6 * 60 * 60 * 1000);
    expect(await refreshRoadmap()).toBe(true);
    expect(calls).toBe(3);
  });

  test("rate limits, timeouts and oversized responses fall back to a calm state", async () => {
    globalThis.fetch = (async () =>
      new Response("{}", {
        status: 403,
        headers: { "x-ratelimit-remaining": "0" },
      })) as unknown as typeof fetch;
    await refreshRoadmap();
    expect(useRoadmapStore.getState().error).toBe("rate-limit");
    useRoadmapStore.setState({ checkedAt: 0 });
    globalThis.fetch = (async () => new Response("", { status: 429 })) as unknown as typeof fetch;
    await refreshRoadmap();
    expect(useRoadmapStore.getState().error).toBe("rate-limit");

    useRoadmapStore.setState({ checkedAt: 0 });
    let signal: AbortSignal | undefined;
    globalThis.fetch = ((_url: string, init: RequestInit) => {
      signal = init.signal ?? undefined;
      return Promise.reject(new DOMException("Zeitüberschreitung", "TimeoutError"));
    }) as unknown as typeof fetch;
    await refreshRoadmap();
    expect(signal).toBeDefined();
    expect(useRoadmapStore.getState().error).toBe("failed");
    expect(useRoadmapStore.getState().loading).toBe(false);

    useRoadmapStore.setState({ checkedAt: 0 });
    globalThis.fetch = (async () =>
      new Response("x".repeat(500_000), { status: 200 })) as unknown as typeof fetch;
    await refreshRoadmap();
    expect(useRoadmapStore.getState().error).toBe("failed");

    useRoadmapStore.setState({ checkedAt: 0 });
    globalThis.fetch = (async () => new Response("", { status: 404 })) as unknown as typeof fetch;
    await refreshRoadmap();
    expect(useRoadmapStore.getState().error).toBe("missing");
  });

  test("works on WebViews without AbortSignal.timeout", async () => {
    const original = AbortSignal.timeout;
    Object.defineProperty(AbortSignal, "timeout", { value: undefined, configurable: true });
    try {
      useRoadmapStore.setState({ checkedAt: 0, feed: null, fetchedAt: 0 });
      globalThis.fetch = (async () =>
        new Response(
          release({ schemaVersion: 1, items: [item("ohne")] }),
        )) as unknown as typeof fetch;
      await refreshRoadmap();
      expect(useRoadmapStore.getState().error).toBeNull();
      expect(cachedRoadmap()?.items[0]?.id).toBe("ohne");
    } finally {
      Object.defineProperty(AbortSignal, "timeout", { value: original, configurable: true });
    }
  });

  test("the cache expires after 48 hours, also after a restart", async () => {
    const feed = parseRoadmap({ schemaVersion: 1, items: [item("a")] });
    useRoadmapStore.setState({ feed, fetchedAt: now - ROADMAP_CACHE_MS + 1000 });
    expect(cachedRoadmap()).not.toBeNull();
    setSystemTime(now + 1000);
    expect(cachedRoadmap()).toBeNull();
    localStorage.setItem(
      "l8db.discovery.roadmap",
      JSON.stringify({
        state: { feed, fetchedAt: now - ROADMAP_CACHE_MS - 1, checkedAt: 0 },
        version: 1,
      }),
    );
    await useRoadmapStore.persist.rehydrate();
    expect(useRoadmapStore.getState().feed).toBeNull();
    localStorage.removeItem("l8db.discovery.roadmap");
  });
});

describe("team tips", () => {
  const tip = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    title: `Tipp ${id}`,
    body: "Text",
    ...extra,
  });

  test("validates, trims and caps tips", () => {
    expect(parseTeamTips(undefined)).toEqual([]);
    expect(parseTeamTips({})).toEqual([]);
    const many = Array.from({ length: 30 }, (_, i) => tip(`t${i}`));
    expect(parseTeamTips(many)).toHaveLength(MAX_TEAM_TIPS);
    const [clipped] = parseTeamTips([tip("a", { title: "T".repeat(200), body: "B".repeat(900) })]);
    expect(clipped?.title).toHaveLength(80);
    expect(clipped?.body).toHaveLength(600);
    expect(
      parseTeamTips([
        tip("ok", { featureId: "explain" }),
        tip("ok"),
        tip("bad id!"),
        { id: "x", title: "T" },
        tip("datum", { until: "morgen" }),
        tip("feature", { featureId: "<script>" }),
      ]).map((entry) => [entry.id, entry.featureId]),
    ).toEqual([
      ["ok", "explain"],
      ["feature", undefined],
    ]);
  });

  test("until is inclusive for dates and exact for timestamps", () => {
    const tips = [
      tip("tag", { until: "2026-11-08" }),
      tip("zeit", { until: "2026-11-08T12:00:00Z" }),
    ];
    expect(activeTeamTips(tips, new Date(2026, 10, 8, 23, 59).getTime()).map((t) => t.id)).toEqual([
      "tag",
    ]);
    expect(activeTeamTips(tips, new Date(2026, 10, 9, 0, 0).getTime())).toEqual([]);
    expect(activeTeamTips(tips, Date.parse("2026-11-08T11:59:59Z"))).toHaveLength(2);
  });

  test("team sync takes over tips and each id is offered once", async () => {
    teamPayload = {
      path: "/x/.l8db/connections.json",
      exists: true,
      connections: [],
      tips: [tip("a"), tip("b"), "kaputt"],
    };
    await syncTeam();
    const tips = activeTeamTips(useTeamStore.getState().tips);
    expect(tips.map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(nextTeamTip(tips, useTeamTipsStore.getState().seen)?.id).toBe("a");
    useTeamTipsStore.getState().markSeen("a");
    useTeamTipsStore.getState().markSeen("a", now + 1);
    expect(useTeamTipsStore.getState().seen.a).toBe(now);
    expect(nextTeamTip(tips, useTeamTipsStore.getState().seen)?.id).toBe("b");
    useTeamTipsStore.getState().markSeen("b");
    expect(nextTeamTip(tips, useTeamTipsStore.getState().seen)).toBeNull();
    teamPayload = { path: "/x/.l8db/connections.json", exists: true, connections: [] };
    await syncTeam();
    expect(useTeamStore.getState().tips).toEqual([]);
  });

  test("the team tab is only visible with a team file", () => {
    const team = DISCOVER_TABS.find((tab) => tab.id === "team");
    expect(team?.visible?.({ teamExists: false })).toBe(false);
    expect(team?.visible?.({ teamExists: true })).toBe(true);
    const ids = (teamExists: boolean) => visibleDiscoverTabs({ teamExists }).map((tab) => tab.id);
    expect(ids(false)).not.toContain("team");
    expect(ids(true)).toContain("team");
    expect(ids(true).length).toBe(DISCOVER_TABS.length);
  });
});

describe("recap", () => {
  test("the offer window runs from 1 December to 15 January across the year change", () => {
    expect(recapYear(new Date(2026, 10, 30, 23, 59))).toBeNull();
    expect(recapYear(new Date(2026, 11, 1, 0, 0))).toBe(2026);
    expect(recapYear(new Date(2026, 11, 31, 23, 59))).toBe(2026);
    expect(recapYear(new Date(2027, 0, 1, 0, 0))).toBe(2026);
    expect(recapYear(new Date(2027, 0, 15, 23, 59))).toBe(2026);
    expect(recapYear(new Date(2027, 0, 16, 0, 0))).toBeNull();
  });

  test("empty data yields an empty recap with three untried features", () => {
    const recap = computeRecap({
      year: 2026,
      statistics: emptyStatistics(),
      usage: {},
      days: {},
      longestMs: 0,
      catalog: FEATURE_CATALOG,
    });
    expect(recap.empty).toBe(true);
    expect(recap.queries).toBe(0);
    expect(recap.activeMonth).toBeNull();
    expect(recap.activeWeekday).toBeNull();
    expect(recap.neverTried).toHaveLength(3);
  });

  test("aggregates queries, families, activity and favourites of the year", () => {
    const store = createUsageStatisticsStore({
      storage: null,
      schedule: () => 0 as never,
      cancel: () => {},
    });
    for (let i = 0; i < 5; i++)
      store.record({
        type: "operation",
        operation: "query",
        kind: "postgres",
        status: "ok",
        ms: 40,
      });
    store.record({ type: "operation", operation: "browse", kind: "mysql", status: "ok", ms: 4000 });
    store.flush();
    const recap = computeRecap({
      year: 2026,
      statistics: store.getSnapshot(),
      usage: {
        explain: { count: 7, first: now, last: now },
        dashboard: { count: 2, first: now, last: now },
        notebook: { count: 9, first: 0, last: new Date(2025, 5, 1).getTime() },
      },
      days: { "2026-03-02": 4, "2026-03-03": 1, "2026-07-01": 2, "2025-03-02": 99 },
      longestMs: 0,
      catalog: FEATURE_CATALOG,
    });
    expect(recap.queries).toBe(5);
    expect(recap.operations).toBe(6);
    expect(recap.families.map((row) => row.kind)).toEqual(["postgres", "mysql"]);
    expect(recap.longestMs).toBe(5000);
    expect(recap.activeMonth).toBe("März");
    expect(recap.activeWeekday).toBe("Montag");
    expect(recap.activeDays).toBe(3);
    expect(recap.topFeatures.map((row) => row.id)).toEqual(["explain", "dashboard"]);
    expect(recap.neverTried.some((entry) => entry.id === "explain")).toBe(false);
  });

  test("no activity is recorded while the statistics are off and the tab offers the switch", () => {
    useSettingsStore.setState({ localUsageStats: false });
    expect(recordRecapActivity(now, 100)).toBe(false);
    expect(useRecapStore.getState().days).toEqual({});
    const html = renderToStaticMarkup(createElement(DiscoverRecapTab));
    expect(html).toContain("Nutzungsstatistik ist aus");
    useSettingsStore.setState({ localUsageStats: true });
    expect(recordRecapActivity(now, 1234)).toBe(true);
    expect(useRecapStore.getState().days["2026-11-08"]).toBe(1);
    expect(useRecapStore.getState().longest).toEqual({ year: 2026, ms: 1234 });
  });
});

describe("achievements", () => {
  test("are opt-in and declare 15 to 20 rules over known features", () => {
    expect(DEFAULT_DISCOVERY_SETTINGS.channels.achievements).toBe(false);
    expect(ACHIEVEMENTS.length).toBeGreaterThanOrEqual(15);
    expect(ACHIEVEMENTS.length).toBeLessThanOrEqual(20);
    for (const rule of ACHIEVEMENTS) {
      for (const id of rule.next) expect(featureById(id)).toBeDefined();
      for (const condition of rule.any)
        if ("feature" in condition)
          for (const id of condition.feature) expect(featureById(id)).toBeDefined();
    }
    recordAchievementEvent({ name: "table.filtered", data: {}, at: now });
    expect(useAchievementsStore.getState().counters).toEqual({});
    expect(evaluateAchievements()).toEqual([]);
  });

  test("retroactive unlocks are summarised in one card instead of a flood", () => {
    const usage = Object.fromEntries(
      FEATURE_CATALOG.slice(0, 30).map((entry) => [entry.id, { count: 12, first: now, last: now }]),
    );
    useFeatureUsageStore.setState({
      usage: { ...usage, explain: { count: 1, first: now, last: now } },
    });
    const store = createUsageStatisticsStore({
      storage: null,
      schedule: () => 0 as never,
      cancel: () => {},
    });
    for (const kind of ["postgres", "mysql", "sqlite"])
      store.record({ type: "operation", operation: "query", kind, status: "ok", ms: 1 });
    store.flush();
    const found = primeAchievements(store.getSnapshot());
    const state = useAchievementsStore.getState();
    expect(found).toBeGreaterThan(3);
    expect(state.pending).toBe(ACHIEVEMENT_SUMMARY);
    expect(state.summaryCount).toBe(found);
    expect(state.unlocked["three-families"]).toBe(now);
    expect(state.unlocked["first-explain"]).toBe(now);
    expect(state.unlocked["power-user"]).toBe(now);
    expect(primeAchievements(store.getSnapshot())).toBe(0);
  });

  test("events unlock single achievements with a next feature", () => {
    primeAchievements(emptyStatistics());
    expect(useAchievementsStore.getState().pending).toBeNull();
    for (let i = 0; i < 9; i++)
      recordAchievementEvent({ name: "table.filtered", data: {}, at: now });
    expect(useAchievementsStore.getState().unlocked["ten-filters"]).toBeUndefined();
    expect(recordAchievementEvent({ name: "table.filtered", data: {}, at: now })).toEqual([
      "ten-filters",
    ]);
    expect(useAchievementsStore.getState().pending).toBe("ten-filters");
    for (const family of ["postgres", "mysql", "mysql", "duckdb"])
      recordAchievementEvent({ name: "table.opened", data: { family }, at: now });
    expect(useAchievementsStore.getState().families).toEqual(["postgres", "mysql", "duckdb"]);
    expect(useAchievementsStore.getState().unlocked["three-families"]).toBe(now);
    recordAchievementEvent({ name: "query.executed", data: { family: "x".repeat(40) }, at: now });
    expect(useAchievementsStore.getState().families).toHaveLength(3);
  });
});

test("every community feature has a NEW badge id", () => {
  for (const id of [
    "discover.labs",
    "discover.roadmap",
    "discover.team-tips",
    "discover.recap",
    "discover.achievements",
  ])
    expect(id in NEW_FEATURES).toBe(true);
  expect(opened).toEqual([]);
});
