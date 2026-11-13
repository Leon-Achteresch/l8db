import { heapSize } from "bun:jsc";
import { Database } from "bun:sqlite";
import { expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { measureScenario, reportScenario } from "../scripts/performance-report";

mock.module("@tauri-apps/plugin-opener", () => ({ openUrl: async () => {} }));

type Listener = (event: unknown) => void;
const host = window as unknown as Record<string, unknown>;
if (typeof host.addEventListener !== "function")
  Object.assign(host, { addEventListener() {}, removeEventListener() {} });
Object.assign(host, {
  matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
});
if (!("localStorage" in globalThis))
  Object.defineProperty(globalThis, "localStorage", {
    value: host.localStorage,
    configurable: true,
  });

const listeners = new Map<string, Set<Listener>>();
const liveTimers = new Set<unknown>();
let liveObservers = 0;
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;

function trackedSetTimeout(callback: () => void, ms?: number) {
  const id = realSetTimeout(() => {
    liveTimers.delete(id);
    callback();
  }, ms);
  liveTimers.add(id);
  return id;
}

function trackedClearTimeout(id: ReturnType<typeof setTimeout>) {
  liveTimers.delete(id);
  realClearTimeout(id);
}

const anchor = {
  isConnected: true,
  tagName: "A",
  contains: (node: unknown) => node === anchor,
  closest: () => null,
  getAttribute: () => null,
  hasAttribute: () => true,
  getBoundingClientRect: () => ({ top: 10, left: 10, width: 40, height: 20 }),
  getClientRects: () => [{}],
  scrollIntoView: () => {},
  click: () => {},
};
let anchorPresent = true;

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
    querySelectorAll: () => (anchorPresent ? [anchor] : []),
  },
  MutationObserver: class {
    constructor() {
      liveObservers++;
    }
    observe() {}
    disconnect() {
      liveObservers--;
    }
  },
  requestAnimationFrame: (callback: () => void) => trackedSetTimeout(callback, 0),
  cancelAnimationFrame: (id: ReturnType<typeof setTimeout>) => trackedClearTimeout(id),
});

const { FEATURE_AREAS, FEATURE_CATALOG } = await import("../src/lib/discovery/catalog");
const { AtlasView } = await import("../src/features/discovery/atlas/atlas-view");
const guide = await import("../src/lib/discovery/guide");
const { demoSeedSql } = await import("../src/lib/discovery/lessons/demo-db");
const { featureSearchContext, FEATURE_CONTEXT_MAX_BYTES } = await import(
  "../src/lib/ai/feature-search"
);

import type { FeatureEntry } from "../src/lib/discovery/types";

function syntheticCatalog(size: number): FeatureEntry[] {
  return Array.from({ length: size }, (_, index) => {
    const base = FEATURE_CATALOG[index % FEATURE_CATALOG.length];
    return {
      ...base,
      id: `${base.id}.${index}`,
      title: `${base.title} ${index}`,
      area: FEATURE_AREAS[index % FEATURE_AREAS.length],
    };
  });
}

test("atlas renders 500 entries within budget", async () => {
  const entries = syntheticCatalog(500);
  const usage = Object.fromEntries(
    entries
      .filter((_, index) => index % 3 === 0)
      .map((item) => [item.id, { count: 1, first: 1, last: 1 }]),
  );
  let html = "";
  Bun.gc(true);
  const before = heapSize();
  const render = await measureScenario(() => {
    html = renderToStaticMarkup(createElement(AtlasView, { available: entries, usage }));
  }, 20);
  Bun.gc(true);
  const retained = heapSize() - before;
  const tiles = html.split("data-atlas-tile").length - 1;
  const nodes = html.split("<").length - html.split("</").length;
  await reportScenario("discovery-atlas-render", {
    entries: entries.length,
    render,
    tiles,
    nodes,
    htmlBytes: html.length,
    retainedBytes: retained,
  });
  expect(tiles).toBe(500);
  expect(html).toContain("Du nutzt 33 % von l8db");
  expect(nodes).toBeLessThan(500 * 12 + 200);
  expect(render.medianMs).toBeLessThan(60);
  expect(render.p95Ms).toBeLessThan(120);
  expect(retained).toBeLessThan(8_000_000);
});

test("guide holds no timers, listeners or observers after stopGuide", async () => {
  Object.assign(globalThis, { setTimeout: trackedSetTimeout, clearTimeout: trackedClearTimeout });
  try {
    const steps = [
      { anchor: "a", title: "A", safeClick: true },
      { anchor: "b", title: "B" },
    ];
    const started = performance.now();
    let peak = 0;
    for (let index = 0; index < 200; index++) {
      anchorPresent = index % 2 === 0;
      guide.startGuide("x", { steps, timeoutMs: 50 });
      await Promise.resolve();
      if (index % 3 === 0) await new Promise((resolve) => realSetTimeout(resolve, 1));
      peak = Math.max(peak, liveTimers.size + liveObservers);
      if (index % 4 === 0) guide.nextGuideStep();
      guide.stopGuide();
    }
    const cycleMs = (performance.now() - started) / 200;
    await new Promise((resolve) => realSetTimeout(resolve, 5));
    const counts = {
      timers: liveTimers.size,
      observers: liveObservers,
      click: listeners.get("click")?.size ?? 0,
      keydown: listeners.get("keydown")?.size ?? 0,
    };
    await reportScenario("discovery-guide-idle", { cycles: 200, cycleMs, peak, ...counts });
    expect(peak).toBeGreaterThan(0);
    expect(counts).toEqual({ timers: 0, observers: 0, click: 0, keydown: 0 });
    expect(guide.isGuideRunning()).toBe(false);
    expect(cycleMs).toBeLessThan(5);
  } finally {
    Object.assign(globalThis, { setTimeout: realSetTimeout, clearTimeout: realClearTimeout });
  }
});

test("demo database seed is fast", async () => {
  const sql = demoSeedSql();
  const db = new Database(":memory:");
  const seed = await measureScenario(() => {
    db.exec(sql);
  }, 10);
  db.close();
  await reportScenario("discovery-demo-seed", { sqlBytes: sql.length, seed });
  expect(sql.length).toBeLessThan(8_000);
  expect(seed.medianMs).toBeLessThan(50);
  expect(seed.p95Ms).toBeLessThan(150);
});

test("ai feature context stays within 2 KB", async () => {
  const questions = [
    "Wie vergleiche ich zwei Schemas?",
    "Wie exportiere ich eine Tabelle als CSV?",
    "Wo finde ich den Verlauf?",
    "Wie kann ich SQL formatieren?",
    "How do I schedule a task?",
    "Wie erstelle ich ein Dashboard?",
  ];
  const large = syntheticCatalog(500);
  let max = 0;
  let index = 0;
  const latency = await measureScenario(() => {
    const context = featureSearchContext(questions[index++ % questions.length], {}, large);
    max = Math.max(max, new TextEncoder().encode(context).length);
  }, 100);
  for (const question of questions)
    max = Math.max(max, new TextEncoder().encode(featureSearchContext(question)).length);
  await reportScenario("discovery-ai-feature-context", { entries: 500, latency, maxBytes: max });
  expect(max).toBeGreaterThan(0);
  expect(max).toBeLessThanOrEqual(FEATURE_CONTEXT_MAX_BYTES);
  expect(latency.p95Ms).toBeLessThan(10);
});
