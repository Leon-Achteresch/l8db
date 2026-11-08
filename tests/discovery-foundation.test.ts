import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

mock.module("@tauri-apps/plugin-opener", () => ({ openUrl: async () => {} }));

type Listener = (event: unknown) => void;
const host = window as unknown as Record<string, unknown>;
if (typeof host.addEventListener !== "function")
  Object.assign(host, { addEventListener() {}, removeEventListener() {} });
if (!("localStorage" in globalThis))
  Object.defineProperty(globalThis, "localStorage", {
    value: host.localStorage,
    configurable: true,
  });

const documentListeners = new Map<string, Set<Listener>>();
let anchors: FakeElement[] = [];
const observers: FakeObserver[] = [];

interface FakeElement {
  feature: string;
  visible: boolean;
  isConnected: boolean;
  closest: (selector: string) => FakeElement | null;
  getAttribute: (name: string) => string | null;
  getBoundingClientRect: () => { top: number; left: number; width: number; height: number };
  getClientRects: () => unknown[];
  scrollIntoView: () => void;
}

class FakeObserver {
  disconnected = false;
  constructor(readonly callback: () => void) {
    observers.push(this);
  }
  observe() {}
  disconnect() {
    this.disconnected = true;
  }
}

function element(feature: string, visible = true): FakeElement {
  const node: FakeElement = {
    feature,
    visible,
    isConnected: true,
    closest: (selector) => (selector === "[data-feature]" ? node : null),
    getAttribute: (name) => (name === "data-feature" ? feature : null),
    getBoundingClientRect: () => ({ top: 10, left: 10, width: visible ? 40 : 0, height: 20 }),
    getClientRects: () => (visible ? [{}] : []),
    scrollIntoView: () => {},
  };
  return node;
}

const fakeDocument = {
  head: { appendChild: () => {} },
  createElement: () => ({ appendChild: () => {}, setAttribute: () => {} }),
  createTextNode: () => ({}),
  getElementsByTagName: () => [],
  hidden: false,
  activeElement: null,
  hasFocus: () => true,
  addEventListener: (type: string, listener: Listener) => {
    const set = documentListeners.get(type) ?? new Set<Listener>();
    set.add(listener);
    documentListeners.set(type, set);
  },
  removeEventListener: (type: string, listener: Listener) => {
    documentListeners.get(type)?.delete(listener);
  },
  querySelectorAll: (selector: string) => {
    const match = /data-feature="([^"]+)"/.exec(selector);
    return anchors.filter((node) => node.feature === match?.[1]);
  },
};
Object.assign(globalThis, {
  document: fakeDocument,
  MutationObserver: FakeObserver,
  requestAnimationFrame: (callback: () => void) => setTimeout(callback, 0),
  cancelAnimationFrame: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
});

const { FEATURE_AREAS, FEATURE_CATALOG, featureById, featuresByArea, searchFeatures } =
  await import("../src/lib/discovery/catalog");
const {
  featureForLocation,
  featureUsed,
  installFeatureUsageTracking,
  MAX_EXTRA_FEATURES,
  onFeatureUsed,
  pruneFeatureUsage,
  recordFeatureUse,
  resetDiscoveryProgress,
  useFeatureUsageStore,
} = await import("../src/lib/discovery/usage");
const { beginQueryEvent, onFeatureEvent, recordFeatureEvent } = await import(
  "../src/lib/discovery/events"
);
const {
  decideSurface,
  getActiveSurface,
  INITIAL_COORDINATOR_STATE,
  MAX_AUTO_SURFACES,
  releaseSurface,
  requestSurface,
  resetCoordinatorSession,
  SURFACE_COOLDOWN_MS,
} = await import("../src/lib/discovery/coordinator");
const {
  clearHighlight,
  highlightFeature,
  isAnchorVisible,
  setHighlightNavigator,
  useHighlightStore,
  waitForAnchor,
} = await import("../src/lib/discovery/highlight");
const { DEFAULT_DISCOVERY_SETTINGS, normalizeDiscoverySettings } = await import(
  "../src/lib/discovery/channels"
);
const { HOTKEY_COMMANDS } = await import("../src/lib/hotkeys/commands");
const { SETTINGS_CATALOG } = await import("../src/lib/settings-catalog");
const { useSettingsStore } = await import("../src/lib/settings");

import type { Capabilities } from "../src/lib/db";
import type { SurfaceContext } from "../src/lib/discovery/coordinator";

const root = join(import.meta.dir, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

function sourceFiles(dir: string): string[] {
  return readdirSync(join(root, dir)).flatMap((name) => {
    const path = `${dir}/${name}`;
    if (statSync(join(root, path)).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

function sourceAnchors(): Set<string> {
  const ids = new Set<string>();
  const literalIds = (path: string) =>
    [...read(path).matchAll(/\bid: "([a-z0-9-]+)"/g)].map((m) => m[1]);
  const templates: Record<string, string> = {
    "settings.": "src/features/settings/settings-sidebar.tsx",
    "automation.": "src/features/automation/automation-toolbar.tsx",
    "versioning.": "src/features/versioning/versioning-sections.ts",
    "discover.": "src/features/discovery/discover-tabs.ts",
  };
  for (const path of sourceFiles("src")) {
    const text = read(path);
    for (const match of text.matchAll(/data-feature="([^"]+)"/g)) ids.add(match[1]);
    for (const match of text.matchAll(/featureAnchor\("([^"]+)"\)/g)) ids.add(match[1]);
    for (const match of text.matchAll(/data-feature=\{`([a-z-]+\.)\$\{[^}]+\}`\}/g)) {
      const source = templates[match[1]];
      expect(source).toBeDefined();
      for (const id of literalIds(source)) ids.add(`${match[1]}${id}`);
    }
  }
  const nav = read("src/features/sidebar/app-sidebar-data.ts");
  for (const match of nav.matchAll(/feature: "([^"]+)"/g)) ids.add(match[1]);
  for (const match of read("src/features/shell/app-nav-rail.tsx").matchAll(/feature: "([^"]+)"/g))
    ids.add(match[1]);
  return ids;
}

const settingsOn = structuredClone(DEFAULT_DISCOVERY_SETTINGS);
function context(overrides: Partial<SurfaceContext> = {}): SurfaceContext {
  return {
    now: 10 * SURFACE_COOLDOWN_MS,
    settings: settingsOn,
    quiet: true,
    blocked: false,
    ...overrides,
  };
}

beforeEach(() => {
  useFeatureUsageStore.setState({ usage: {}, extra: 0 });
  useSettingsStore.setState({ discovery: structuredClone(DEFAULT_DISCOVERY_SETTINGS) });
  resetCoordinatorSession();
  anchors = [];
  observers.length = 0;
});

afterEach(() => {
  clearHighlight();
  setHighlightNavigator(null);
});

describe("catalog integrity", () => {
  test("ids, areas and relations are consistent", () => {
    expect(FEATURE_CATALOG.length).toBeGreaterThanOrEqual(60);
    expect(FEATURE_CATALOG.length).toBeLessThanOrEqual(120);
    const ids = FEATURE_CATALOG.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of FEATURE_CATALOG) {
      expect(FEATURE_AREAS).toContain(entry.area);
      expect(entry.id).toMatch(/^[a-z0-9][a-z0-9._-]{0,79}$/);
      expect(entry.keywords.length).toBeGreaterThan(0);
      for (const related of entry.related ?? []) {
        expect(featureById(related), `${entry.id} → ${related}`).toBeDefined();
        expect(related).not.toBe(entry.id);
      }
    }
    const grouped = featuresByArea();
    expect([...grouped.keys()]).toEqual([...FEATURE_AREAS]);
    expect([...grouped.values()].reduce((sum, list) => sum + list.length, 0)).toBe(ids.length);
  });

  test("hotkeys, videos, routes and settings exist", () => {
    const hotkeys = new Set(HOTKEY_COMMANDS.map((command) => command.id));
    const videos = new Set(
      (JSON.parse(read("scripts/feature-videos/catalog.json")) as { id: string }[]).map(
        (v) => v.id,
      ),
    );
    const tree = read("src/routeTree.gen.ts");
    const fullPaths = tree.slice(tree.indexOf("fullPaths:"), tree.indexOf("fileRoutesByTo:"));
    const settingTabs = new Set(
      [...read("src/features/settings/settings-sidebar.tsx").matchAll(/id: "([a-z]+)"/g)].map(
        (m) => m[1],
      ),
    );
    const settingIds = new Set(SETTINGS_CATALOG.map((setting) => setting.id));
    for (const entry of FEATURE_CATALOG) {
      if (entry.hotkey) expect(hotkeys.has(entry.hotkey), `${entry.id} hotkey`).toBe(true);
      if (entry.videoId) expect(videos.has(entry.videoId), `${entry.id} video`).toBe(true);
      for (const route of [entry.route, ...(entry.steps ?? []).map((step) => step.route)]) {
        if (!route) continue;
        const [path, query] = route.split("?");
        expect(fullPaths.includes(`'${path}'`), `${entry.id} route ${path}`).toBe(true);
        const params = new URLSearchParams(query ?? "");
        if (path === "/settings") {
          expect(settingTabs.has(params.get("tab") ?? ""), `${entry.id} tab`).toBe(true);
          const setting = params.get("setting");
          if (setting) expect(settingIds.has(setting), `${entry.id} setting`).toBe(true);
        }
      }
    }
  });

  test("major features and guide steps point to real anchors", () => {
    const anchorsInSource = sourceAnchors();
    expect(anchorsInSource.size).toBeGreaterThanOrEqual(30);
    const majors = FEATURE_CATALOG.filter((entry) => entry.size === "major");
    expect(majors.length).toBeGreaterThanOrEqual(6);
    expect(majors.length).toBeLessThanOrEqual(14);
    for (const entry of majors)
      expect(anchorsInSource.has(entry.anchor ?? entry.id), `${entry.id} anchor`).toBe(true);
    const guided = FEATURE_CATALOG.filter((entry) => entry.steps?.length);
    expect(guided.length).toBeGreaterThanOrEqual(8);
    for (const entry of guided)
      for (const step of entry.steps ?? [])
        expect(anchorsInSource.has(step.anchor), `${entry.id} step ${step.anchor}`).toBe(true);
    for (const entry of FEATURE_CATALOG)
      if (entry.anchor) expect(anchorsInSource.has(entry.anchor), `${entry.id} anchor`).toBe(true);
  });

  test("lesson steps point to real anchors, routes and catalog features", async () => {
    const { LESSONS } = await import("../src/lib/discovery/lessons/lessons");
    const anchorsInSource = sourceAnchors();
    const tree = read("src/routeTree.gen.ts");
    const fullPaths = tree.slice(tree.indexOf("fullPaths:"), tree.indexOf("fileRoutesByTo:"));
    const events = new Set(["query.executed", "table.opened", "table.filtered", "export.done"]);
    for (const lesson of LESSONS)
      for (const step of lesson.steps) {
        const label = `${lesson.id}/${step.id}`;
        if (step.anchor) expect(anchorsInSource.has(step.anchor), `${label} anchor`).toBe(true);
        if (step.route)
          expect(fullPaths.includes(`'${step.route.split("?")[0]}'`), `${label} route`).toBe(true);
        if ("feature" in step.check) {
          const feature = featureById(step.check.feature);
          expect(
            anchorsInSource.has(step.check.feature) || feature?.route !== undefined,
            `${label} check ${step.check.feature}`,
          ).toBe(true);
        } else expect(events.has(step.check.event), `${label} event`).toBe(true);
      }
  });

  test("the 0.18 release has major features for spotlight and hotspots", async () => {
    const { decideSpotlight } = await import("../src/lib/discovery/spotlight/model");
    const { hotspotCandidates } = await import("../src/lib/discovery/hotspots/model");
    const anchorsInSource = sourceAnchors();
    const majors = FEATURE_CATALOG.filter(
      (entry) => entry.size === "major" && entry.since === "0.18.0",
    );
    expect(majors.length).toBeGreaterThanOrEqual(3);
    for (const entry of majors) {
      expect(anchorsInSource.has(entry.anchor ?? entry.id), `${entry.id} anchor`).toBe(true);
      expect(entry.route, `${entry.id} route`).toBeDefined();
    }
    const decision = decideSpotlight({
      current: "0.18.0",
      seen: "0.17.3",
      lastActive: Date.now(),
      now: Date.now(),
      onboardingDone: true,
      entries: FEATURE_CATALOG,
    });
    expect(decision.action).toBe("show");
    if (decision.action === "show") expect(decision.content.major.length).toBe(3);
    const hotspots = hotspotCandidates(FEATURE_CATALOG, {
      usage: {},
      dismissed: [],
      version: "0.18.0",
      easyMode: false,
    });
    expect(hotspots.length).toBeGreaterThanOrEqual(3);
  });
});

describe("search", () => {
  test("natural German questions and synonyms find the feature", () => {
    expect(searchFeatures("wie vergleiche ich zwei Schemas?")[0]?.id).toBe("schema-compare");
    expect(searchFeatures("diff").map((entry) => entry.id)).toContain("compare");
    expect(searchFeatures("exportieren").map((entry) => entry.id)).toContain("table.export");
    expect(searchFeatures("cron job").map((entry) => entry.id)).toContain("automation");
    expect(searchFeatures("ER-Diagramm")[0]?.id).toBe("er-diagram");
  });

  test("umlauts and case are tolerated", () => {
    for (const query of ["Übersicht", "ubersicht", "uebersicht", "ÜBERSICHT"])
      expect(
        searchFeatures(query).map((entry) => entry.id),
        query,
      ).toContain("home");
    expect(searchFeatures("tastenkurzel").map((entry) => entry.id)).toContain("shortcuts");
  });

  test("limit, capabilities and easy mode filter results", () => {
    expect(searchFeatures("sql", { limit: 3 })).toHaveLength(3);
    expect(searchFeatures("", { limit: 5 })).toHaveLength(5);
    expect(searchFeatures("xyzqwv")).toEqual([]);
    const noKeys = { foreign_keys: false, query_language: "sql" } as unknown as Capabilities;
    expect(searchFeatures("diagramm", { capabilities: noKeys }).map((e) => e.id)).not.toContain(
      "er-diagram",
    );
    expect(searchFeatures("mcp", { easyMode: true }).map((e) => e.id)).not.toContain("mcp");
    expect(searchFeatures("mcp").map((e) => e.id)).toContain("mcp");
    expect(
      searchFeatures("diagramm", { areas: ["Dashboards"] }).every((e) => e.area === "Dashboards"),
    ).toBe(true);
  });
});

describe("usage", () => {
  test("records catalog features with count, first and last", () => {
    expect(recordFeatureUse("er-diagram", 100)).toBe(true);
    expect(recordFeatureUse("er-diagram", 200)).toBe(true);
    expect(useFeatureUsageStore.getState().usage["er-diagram"]).toEqual({
      count: 2,
      first: 100,
      last: 200,
    });
    expect(featureUsed("er-diagram")).toBe(true);
    expect(featureUsed("notebook")).toBe(false);
    expect(recordFeatureUse("bad id with spaces")).toBe(false);
  });

  test("unknown ids are capped while catalog ids stay recordable", () => {
    for (let index = 0; index < MAX_EXTRA_FEATURES + 50; index++)
      recordFeatureUse(`extra.${index}`);
    const usage = useFeatureUsageStore.getState().usage;
    expect(Object.keys(usage)).toHaveLength(MAX_EXTRA_FEATURES);
    expect(recordFeatureUse("extra.0")).toBe(true);
    expect(recordFeatureUse("notebook")).toBe(true);
    expect(Object.keys(useFeatureUsageStore.getState().usage)).toHaveLength(MAX_EXTRA_FEATURES + 1);
    const pruned = pruneFeatureUsage({
      ...Object.fromEntries(
        Array.from({ length: 400 }, (_, i) => [`x.${i}`, { count: 1, first: 1, last: 1 }]),
      ),
      notebook: { count: 2, first: 1, last: 2 },
      broken: { count: "a" },
    });
    expect(Object.keys(pruned)).toHaveLength(MAX_EXTRA_FEATURES + 1);
    expect(pruned.broken).toBeUndefined();
  });

  test("disabled discovery records nothing and listeners can unsubscribe", () => {
    const seen: string[] = [];
    const stop = onFeatureUsed((id) => seen.push(id));
    recordFeatureUse("notebook");
    useSettingsStore.getState().setDiscovery({ enabled: false });
    recordFeatureUse("dashboard");
    stop();
    useSettingsStore.getState().setDiscovery({ enabled: true });
    recordFeatureUse("automation");
    expect(seen).toEqual(["notebook"]);
    expect(featureUsed("dashboard")).toBe(false);
  });

  test("routes map to the first matching catalog entry", () => {
    expect(featureForLocation("/er-diagram")).toBe("er-diagram");
    expect(featureForLocation("/query")).toBe("query.workspace");
    expect(featureForLocation("/settings", { tab: "cli" })).toBe("settings.cli");
    expect(featureForLocation("/settings", { tab: "general" })).toBeNull();
    expect(featureForLocation("/settings", { tab: "general", setting: "easy-mode" })).toBe(
      "settings.easy-mode",
    );
    expect(featureForLocation("/nowhere")).toBeNull();
  });

  test("auto tracking records clicks and routes and cleans up", () => {
    let routeListener: (() => void) | null = null;
    const router = {
      state: { location: { pathname: "/dashboard", search: {} } },
      subscribe: (_: "onResolved", listener: () => void) => {
        routeListener = listener;
        return () => {
          routeListener = null;
        };
      },
    };
    const stop = installFeatureUsageTracking(router);
    expect(featureUsed("dashboard")).toBe(true);
    for (const listener of documentListeners.get("click") ?? [])
      listener({ target: element("table.export") });
    expect(featureUsed("table.export")).toBe(true);
    router.state.location = { pathname: "/notebook", search: {} };
    routeListener?.();
    expect(featureUsed("notebook")).toBe(true);
    stop();
    expect(documentListeners.get("click")?.size ?? 0).toBe(0);
    expect(routeListener).toBeNull();
  });

  test("reset clears usage and notifies stores", () => {
    recordFeatureUse("notebook");
    localStorage.setItem("l8db.discovery.other", "{}");
    resetDiscoveryProgress();
    expect(featureUsed("notebook")).toBe(false);
  });
});

describe("events", () => {
  test("query events carry hashes and timing but no SQL", () => {
    const events: { name: string; data: Record<string, unknown> }[] = [];
    const stop = onFeatureEvent((event) => events.push(event));
    const finish = beginQueryEvent(
      "SELECT secret FROM users u JOIN orders o ON o.u = u.id WHERE x = 'pw'",
      "postgres",
    );
    finish(true);
    finish(false);
    stop();
    expect(events.map((event) => event.name)).toEqual([
      "query.started",
      "query.finished",
      "query.executed",
    ]);
    const executed = events[2].data;
    expect(executed).toMatchObject({ ok: true, hasJoin: true, hasWhere: true, family: "postgres" });
    expect(String(executed.hash)).toMatch(/^[0-9a-f]{8}$/);
    expect(JSON.stringify(events)).not.toContain("secret");
    expect(events[0].data.id).toBe(events[1].data.id);
    let calls = 0;
    beginQueryEvent("select 1")(true);
    recordFeatureEvent("table.opened", { family: null });
    expect(calls).toBe(0);
    const again = onFeatureEvent(() => {
      calls++;
      throw new Error("listener failure");
    });
    recordFeatureEvent("export.done", { target: "abc" });
    again();
    expect(calls).toBe(1);
  });
});

describe("coordinator", () => {
  const auto = { channel: "promoter" as const, id: "a", priority: 1 };

  test("cooldown, session limit and quiet gate", () => {
    let state = { ...INITIAL_COORDINATOR_STATE };
    expect(decideSurface(auto, state, context())).toEqual({ ok: true, preempts: false });
    state = { active: null, lastAutoAt: 1000, autoCount: 1 };
    expect(decideSurface(auto, state, context({ now: 1000 + SURFACE_COOLDOWN_MS - 1 }))).toEqual({
      ok: false,
      reason: "cooldown",
    });
    expect(decideSurface(auto, state, context({ now: 1000 + SURFACE_COOLDOWN_MS })).ok).toBe(true);
    state = { active: null, lastAutoAt: 0, autoCount: MAX_AUTO_SURFACES };
    expect(decideSurface(auto, state, context())).toEqual({ ok: false, reason: "limit" });
    expect(decideSurface(auto, INITIAL_COORDINATOR_STATE, context({ quiet: false }))).toEqual({
      ok: false,
      reason: "quiet",
    });
    expect(decideSurface(auto, INITIAL_COORDINATOR_STATE, context({ blocked: true }))).toEqual({
      ok: false,
      reason: "blocked",
    });
  });

  test("switches, explicit surfaces and priorities", () => {
    const off = normalizeDiscoverySettings({ channels: { promoter: false } });
    expect(off.channels.achievements).toBe(false);
    expect(off.channels.waitTips).toBe(true);
    expect(decideSurface(auto, INITIAL_COORDINATOR_STATE, context({ settings: off }))).toEqual({
      ok: false,
      reason: "channel",
    });
    const disabled = { ...settingsOn, enabled: false };
    expect(decideSurface(auto, INITIAL_COORDINATOR_STATE, context({ settings: disabled }))).toEqual(
      {
        ok: false,
        reason: "disabled",
      },
    );
    const explicit = { ...auto, explicit: true };
    const busyState = {
      active: { channel: "waitTips" as const, id: "w", priority: 5, explicit: false, since: 0 },
      lastAutoAt: 10 * SURFACE_COOLDOWN_MS,
      autoCount: MAX_AUTO_SURFACES,
    };
    expect(
      decideSurface(
        explicit,
        busyState,
        context({ settings: disabled, quiet: false, blocked: true }),
      ),
    ).toEqual({ ok: true, preempts: true });
    expect(decideSurface(auto, { ...busyState, autoCount: 0 }, context())).toEqual({
      ok: false,
      reason: "busy",
    });
    expect(
      decideSurface({ ...auto, priority: 9 }, { ...busyState, autoCount: 0 }, context()),
    ).toEqual({
      ok: true,
      preempts: true,
    });
  });

  test("concurrent requests grant exactly one surface", () => {
    const results = ["a", "b", "c"].map((id) => requestSurface({ ...auto, id }, context()));
    expect(results).toEqual([true, false, false]);
    expect(getActiveSurface()?.id).toBe("a");
    expect(requestSurface(auto, context())).toBe(true);
    releaseSurface("promoter", "b");
    expect(getActiveSurface()?.id).toBe("a");
    releaseSurface("promoter", "a");
    expect(getActiveSurface()).toBeNull();
    expect(requestSurface({ ...auto, id: "b" }, context())).toBe(false);
    expect(requestSurface({ ...auto, id: "b" }, context({ now: 11 * SURFACE_COOLDOWN_MS }))).toBe(
      true,
    );
  });
});

describe("highlight", () => {
  test("a disabled button inside a closed tooltip trigger still counts as visible", () => {
    const button = element("query.run");
    const wrapped = {
      ...button,
      closest: (selector: string) =>
        selector.includes('[data-state="closed"]') ? {} : button.closest(selector),
    };
    const hidden = {
      ...button,
      closest: (selector: string) => (selector.includes("[hidden]") ? {} : null),
    };
    expect(isAnchorVisible(wrapped as unknown as HTMLElement)).toBe(true);
    expect(isAnchorVisible(hidden as unknown as HTMLElement)).toBe(false);
  });

  test("waiting for an anchor times out, aborts and resolves on mutation", async () => {
    const started = performance.now();
    expect(await waitForAnchor("notebook", { timeoutMs: 30 })).toBeNull();
    expect(performance.now() - started).toBeLessThan(500);
    expect(observers.every((observer) => observer.disconnected)).toBe(true);

    const controller = new AbortController();
    const aborted = waitForAnchor("notebook", { signal: controller.signal, timeoutMs: 5000 });
    controller.abort();
    expect(await aborted).toBeNull();

    const pending = waitForAnchor("notebook", { timeoutMs: 5000 });
    anchors = [element("notebook")];
    for (const observer of observers) observer.callback();
    expect((await pending)?.feature).toBe("notebook");
    expect(observers.every((observer) => observer.disconnected)).toBe(true);
  });

  test("highlightFeature navigates, shows the ring and reports hidden or missing anchors", async () => {
    const visited: string[] = [];
    let href = "/";
    setHighlightNavigator({
      navigate: (next) => {
        visited.push(next);
        href = next;
        anchors = [element("er-diagram")];
      },
      href: () => href,
    });
    expect(await highlightFeature("does-not-exist")).toBe("unknown");
    expect(await highlightFeature("er-diagram")).toBe("shown");
    expect(visited).toEqual(["/er-diagram"]);
    expect(useHighlightStore.getState().target?.id).toBe("er-diagram");
    expect(getActiveSurface()).toMatchObject({ channel: "spotlight", explicit: true });
    clearHighlight();
    expect(getActiveSurface()).toBeNull();

    anchors = [element("notebook", false)];
    href = "/notebook";
    expect(await highlightFeature("notebook", { timeoutMs: 20 })).toBe("hidden");
    anchors = [];
    expect(await highlightFeature("automation", { timeoutMs: 20 })).toBe("missing");
    const controller = new AbortController();
    const pending = highlightFeature("dashboard", { signal: controller.signal, timeoutMs: 5000 });
    controller.abort();
    expect(await pending).toBe("aborted");
    expect(useHighlightStore.getState().target).toBeNull();
  });
});
