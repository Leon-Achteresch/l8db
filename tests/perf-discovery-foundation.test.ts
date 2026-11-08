import { heapSize } from "bun:jsc";
import { expect, mock, test } from "bun:test";
import { measureScenario, reportScenario } from "../scripts/performance-report";

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

const listeners = new Map<string, Set<Listener>>();
let nodes: { feature: string }[] = [];
Object.assign(globalThis, {
  document: {
    head: { appendChild: () => {} },
    createElement: () => ({ appendChild: () => {}, setAttribute: () => {} }),
    createTextNode: () => ({}),
    getElementsByTagName: () => [],
    hidden: false,
    activeElement: null,
    hasFocus: () => true,
    addEventListener: (type: string, listener: Listener) => {
      const set = listeners.get(type) ?? new Set<Listener>();
      set.add(listener);
      listeners.set(type, set);
    },
    removeEventListener: (type: string, listener: Listener) =>
      listeners.get(type)?.delete(listener),
    querySelectorAll: (selector: string) => {
      const id = /data-feature="([^"]+)"/.exec(selector)?.[1];
      return nodes.filter((node) => node.feature === id);
    },
  },
  MutationObserver: class {
    observe() {}
    disconnect() {}
  },
  requestAnimationFrame: (callback: () => void) => setTimeout(callback, 0),
  cancelAnimationFrame: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
});

const { FEATURE_AREAS, FEATURE_CATALOG, searchFeatures } = await import(
  "../src/lib/discovery/catalog"
);
const { installFeatureUsageTracking, MAX_EXTRA_FEATURES, recordFeatureUse, useFeatureUsageStore } =
  await import("../src/lib/discovery/usage");
const { decideSurface, INITIAL_COORDINATOR_STATE, installDiscoveryCoordinator } = await import(
  "../src/lib/discovery/coordinator"
);
const { DEFAULT_DISCOVERY_SETTINGS } = await import("../src/lib/discovery/channels");
const { waitForAnchor } = await import("../src/lib/discovery/highlight");

import type { FeatureEntry } from "../src/lib/discovery/types";

const QUERIES = [
  "wie vergleiche ich zwei schemas",
  "übersicht",
  "export csv",
  "ki filter",
  "tastenkurzel",
  "cron",
  "er diagramm",
  "sql formatieren",
  "langsame abfrage",
  "xyz",
];

function syntheticCatalog(size: number): FeatureEntry[] {
  return Array.from({ length: size }, (_, index) => {
    const base = FEATURE_CATALOG[index % FEATURE_CATALOG.length];
    return {
      ...base,
      id: `${base.id}.${index}`,
      title: `${base.title} ${index}`,
      area: FEATURE_AREAS[index % FEATURE_AREAS.length],
      keywords: [...base.keywords, `stichwort${index}`],
    };
  });
}

test("catalog search stays fast over 500 entries", async () => {
  const entries = syntheticCatalog(500);
  let query = 0;
  const search = await measureScenario(() => {
    searchFeatures(QUERIES[query++ % QUERIES.length], { limit: 8 }, entries);
  }, 200);
  const real = await measureScenario(() => {
    searchFeatures(QUERIES[query++ % QUERIES.length]);
  }, 200);
  await reportScenario("discovery-search", {
    entries: entries.length,
    syntheticSearch: search,
    catalogEntries: FEATURE_CATALOG.length,
    catalogSearch: real,
  });
  expect(search.medianMs).toBeLessThan(5);
  expect(search.p95Ms).toBeLessThan(10);
  expect(real.p95Ms).toBeLessThan(2);
});

test("10 000 feature uses stay within the id limit", async () => {
  useFeatureUsageStore.setState({ usage: {}, extra: 0 });
  Bun.gc(true);
  const before = heapSize();
  const started = performance.now();
  for (let index = 0; index < 10_000; index++) {
    const known = FEATURE_CATALOG[index % FEATURE_CATALOG.length].id;
    recordFeatureUse(index % 2 === 0 ? known : `extra.${index}`, index);
  }
  const totalMs = performance.now() - started;
  Bun.gc(true);
  const retained = heapSize() - before;
  const ids = Object.keys(useFeatureUsageStore.getState().usage).length;
  const stored = localStorage.getItem("l8db.discovery.usage")?.length ?? 0;
  await reportScenario("discovery-usage-bounds", {
    calls: 10_000,
    totalMs,
    perCallMs: totalMs / 10_000,
    ids,
    limit: FEATURE_CATALOG.length + MAX_EXTRA_FEATURES,
    storedBytes: stored,
    retainedBytes: retained,
  });
  expect(ids).toBeLessThanOrEqual(FEATURE_CATALOG.length + MAX_EXTRA_FEATURES);
  expect(stored).toBeLessThan(64_000);
  expect(retained).toBeLessThan(2_000_000);
  expect(totalMs / 10_000).toBeLessThan(0.5);
});

test("coordinator decisions are cheap", async () => {
  const context = {
    now: 10_000_000,
    settings: DEFAULT_DISCOVERY_SETTINGS,
    quiet: true,
    blocked: false,
  };
  const state = { ...INITIAL_COORDINATOR_STATE, lastAutoAt: 1, autoCount: 2 };
  const decisions = await measureScenario(() => {
    for (let index = 0; index < 1000; index++)
      decideSurface({ channel: "promoter", id: `p${index}`, priority: index % 3 }, state, context);
  }, 100);
  await reportScenario("discovery-coordinator", { decisionsPerRun: 1000, decisions });
  expect(decisions.p95Ms).toBeLessThan(2);
});

test("idle discovery installs no timers and removes every listener", async () => {
  const originalSetInterval = globalThis.setInterval;
  const originalSetTimeout = globalThis.setTimeout;
  let intervals = 0;
  let timeouts = 0;
  globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => {
    intervals++;
    return originalSetInterval(...args);
  }) as typeof setInterval;
  globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>) => {
    timeouts++;
    return originalSetTimeout(...args);
  }) as typeof setTimeout;
  try {
    const router = {
      state: { location: { pathname: "/", search: {} } },
      subscribe: () => () => {},
    };
    const stopTracking = installFeatureUsageTracking(router);
    const stopCoordinator = installDiscoveryCoordinator();
    const active = [...listeners.values()].reduce((sum, set) => sum + set.size, 0);
    expect(intervals).toBe(0);
    expect(timeouts).toBe(0);
    stopTracking();
    stopCoordinator();
    const remaining = [...listeners.values()].reduce((sum, set) => sum + set.size, 0);

    nodes = Array.from({ length: 5000 }, (_, index) => ({ feature: `node.${index}` }));
    const controller = new AbortController();
    const pending = waitForAnchor("never", { signal: controller.signal, timeoutMs: 4000 });
    controller.abort();
    expect(await pending).toBeNull();
    await reportScenario("discovery-idle", {
      listenersWhileInstalled: active,
      listenersAfterCleanup: remaining,
      intervals,
      timeoutsForAbortedWait: timeouts,
      domNodes: nodes.length,
    });
    expect(remaining).toBe(0);
    expect(intervals).toBe(0);
  } finally {
    globalThis.setInterval = originalSetInterval;
    globalThis.setTimeout = originalSetTimeout;
    nodes = [];
  }
});
