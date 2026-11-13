import { heapSize } from "bun:jsc";
import { afterEach, expect, mock, test } from "bun:test";
import { measureScenario, reportScenario } from "../scripts/performance-report";

mock.module("@tauri-apps/plugin-opener", () => ({ openUrl: async () => {} }));

const host = window as unknown as Record<string, unknown>;
if (typeof host.addEventListener !== "function")
  Object.assign(host, { addEventListener() {}, removeEventListener() {} });
if (!("localStorage" in globalThis))
  Object.defineProperty(globalThis, "localStorage", {
    value: host.localStorage,
    configurable: true,
  });

const { hasFeatureEventListeners, recordFeatureEvent } = await import(
  "../src/lib/discovery/events"
);
const { recordFeatureUse } = await import("../src/lib/discovery/usage");
const { evaluatePromoterRules, PROMOTER_MAX_WINDOW_EVENTS, pushPromoterEvent } = await import(
  "../src/lib/discovery/promoter/engine"
);
const { installPromoter } = await import("../src/lib/discovery/promoter/controller");
const { usePromoterStore } = await import("../src/lib/discovery/promoter/store");
const { installWaitTips } = await import("../src/lib/discovery/wait-tips/controller");
const { useWaitTipStore } = await import("../src/lib/discovery/wait-tips/current");
const { pickWaitTip, waitTipsFor } = await import("../src/lib/discovery/wait-tips/pick");
const { installFeedback } = await import("../src/lib/discovery/feedback/controller");
const { installRelated } = await import("../src/lib/discovery/related/controller");
const { POSTGRES_CAPABILITIES } = await import("../src/lib/providers");

import type { FeatureEvent } from "../src/lib/discovery/events";

const NAMES = ["query.executed", "query.executed", "table.opened", "export.done", "table.filtered"];

function syntheticEvent(index: number): FeatureEvent {
  const name = NAMES[index % NAMES.length];
  return {
    name,
    at: 1_800_000_000_000 + index * 700,
    data: {
      hash: `h${index % 37}`,
      ok: index % 11 !== 0,
      durationMs: (index * 97) % 7_000,
      hasJoin: index % 3 === 0,
      hasWhere: index % 4 === 0,
      family: "postgres",
      drawer: false,
      target: `t${index % 5}`,
    },
  };
}

function trackTimers() {
  const active = new Set<unknown>();
  let created = 0;
  const original = { setTimeout, clearTimeout, setInterval, clearInterval };
  Object.assign(globalThis, {
    setTimeout: (callback: () => void, ms?: number) => {
      created++;
      const id = original.setTimeout(() => {
        active.delete(id);
        callback();
      }, ms);
      active.add(id);
      return id;
    },
    clearTimeout: (id: ReturnType<typeof setTimeout>) => {
      active.delete(id);
      original.clearTimeout(id);
    },
    setInterval: (callback: () => void, ms?: number) => {
      created++;
      const id = original.setInterval(callback, ms);
      active.add(id);
      return id;
    },
    clearInterval: (id: ReturnType<typeof setInterval>) => {
      active.delete(id);
      original.clearInterval(id);
    },
  });
  return {
    active,
    created: () => created,
    restore: () => Object.assign(globalThis, original),
  };
}

let restoreTimers: (() => void) | null = null;
afterEach(() => {
  restoreTimers?.();
  restoreTimers = null;
});

test("10 000 events through the promoter rule engine", async () => {
  const window: FeatureEvent[] = [];
  const events = Array.from({ length: 10_000 }, (_, index) => syntheticEvent(index));
  Bun.gc(true);
  const before = heapSize();
  let index = 0;
  let matched = 0;
  const perEvent = await measureScenario(() => {
    const event = events[index++ % events.length];
    if (!pushPromoterEvent(window, event)) return;
    matched += evaluatePromoterRules(window, {}, event.at, {
      capabilities: POSTGRES_CAPABILITIES,
    }).length;
  }, 10_000);
  Bun.gc(true);
  const retained = heapSize() - before;
  await reportScenario("discovery-promoter-engine", {
    events: events.length,
    windowEvents: window.length,
    matched,
    perEvent,
    retainedBytes: retained,
  });
  expect(window.length).toBeLessThanOrEqual(PROMOTER_MAX_WINDOW_EVENTS);
  expect(matched).toBeGreaterThan(0);
  expect(perEvent.medianMs).toBeLessThan(0.2);
  expect(perEvent.p95Ms).toBeLessThan(0.5);
  expect(retained).toBeLessThan(4 * 1024 * 1024);
});

test("controller handles 10 000 bus events with a bounded window and cleans up", async () => {
  usePromoterStore.setState({ stats: {}, active: null });
  let attempts = 0;
  const stop = installPromoter(() => ({ capabilities: POSTGRES_CAPABILITIES, easyMode: false }), {
    attempt: () => {
      attempts++;
      return "stop";
    },
  });
  const started = performance.now();
  for (let index = 0; index < 10_000; index++) {
    const event = syntheticEvent(index);
    recordFeatureEvent(event.name, event.data);
  }
  const totalMs = performance.now() - started;
  stop();
  await reportScenario("discovery-promoter-bus", { events: 10_000, totalMs, attempts });
  expect(totalMs).toBeLessThan(2_000);
  expect(attempts).toBeLessThanOrEqual(9 * 3);
  expect(hasFeatureEventListeners()).toBe(false);
});

test("no timers or listeners while idle and after unmount", async () => {
  const timers = trackTimers();
  restoreTimers = timers.restore;
  const context = () => ({ capabilities: POSTGRES_CAPABILITIES, easyMode: false });
  const stops = [
    installPromoter(context),
    installWaitTips({ enabled: () => true }),
    installFeedback(),
    installRelated(context),
  ];
  expect(timers.created()).toBe(0);
  expect(hasFeatureEventListeners()).toBe(true);
  await Bun.sleep(20);
  expect(timers.active.size).toBe(0);
  for (const stop of stops) stop();
  expect(hasFeatureEventListeners()).toBe(false);
  recordFeatureUse("explain");
  recordFeatureEvent("query.started", { id: "late", family: "postgres" });
  expect(timers.active.size).toBe(0);
});

test("1 000 short queries leave no wait-tip timers behind", async () => {
  const timers = trackTimers();
  restoreTimers = timers.restore;
  const filter = () => ({
    family: "postgres",
    capabilities: POSTGRES_CAPABILITIES,
    easyMode: false,
    usage: {},
  });
  const stop = installWaitTips({ enabled: () => true, resolve: filter });
  const cycle = await measureScenario(() => {
    const id = `q${Math.random()}`;
    recordFeatureEvent("query.started", { id, family: "postgres" });
    recordFeatureEvent("query.finished", { id, ok: true });
  }, 1_000);
  expect(timers.active.size).toBe(0);
  expect(useWaitTipStore.getState().tip).toBeNull();
  for (let index = 0; index < 100; index++)
    recordFeatureEvent("query.started", { id: `open${index}`, family: "postgres" });
  expect(timers.active.size).toBeLessThanOrEqual(32);
  stop();
  expect(timers.active.size).toBe(0);
  const tips = waitTipsFor(filter());
  let seen: string[] = [];
  const pick = await measureScenario(() => {
    seen = pickWaitTip(tips, seen).seen;
  }, 2_000);
  await reportScenario("discovery-wait-tips", { tips: tips.length, cycle, pick });
  expect(cycle.p95Ms).toBeLessThan(0.5);
  expect(pick.p95Ms).toBeLessThan(0.5);
  expect(seen.length).toBeLessThanOrEqual(512);
});
