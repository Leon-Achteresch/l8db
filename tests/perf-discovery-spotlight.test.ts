import { afterAll, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { measureScenario, reportScenario } from "../scripts/performance-report";

mock.module("@tauri-apps/plugin-opener", () => ({ openUrl: async () => {} }));

const host = window as unknown as Record<string, unknown>;
const saved: [Record<string, unknown>, string, boolean, unknown][] = [];
function provide(target: Record<string, unknown>, key: string, value: unknown) {
  saved.push([target, key, key in target, target[key]]);
  target[key] = value;
}

const windowListeners = new Map<string, Set<unknown>>();
provide(host, "addEventListener", (type: string, listener: unknown) => {
  const set = windowListeners.get(type) ?? new Set();
  set.add(listener);
  windowListeners.set(type, set);
});
provide(host, "removeEventListener", (type: string, listener: unknown) => {
  windowListeners.get(type)?.delete(listener);
});
provide(host, "innerWidth", 1440);
provide(host, "innerHeight", 900);
if (!("localStorage" in globalThis))
  Object.defineProperty(globalThis, "localStorage", {
    value: host.localStorage,
    configurable: true,
  });

const live = { mutation: 0, resize: 0, intersection: 0 };
let mutationCallback: (() => void) | null = null;
class FakeMutationObserver {
  constructor(callback: () => void) {
    mutationCallback = callback;
    live.mutation++;
  }
  observe() {}
  disconnect() {
    live.mutation--;
  }
}
class FakeResizeObserver {
  constructor(readonly callback: () => void) {
    live.resize++;
  }
  observe() {}
  disconnect() {
    live.resize--;
  }
}
let intersectionCallback: ((entries: { isIntersecting: boolean }[]) => void) | null = null;
class FakeIntersectionObserver {
  constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
    intersectionCallback = callback;
    live.intersection++;
  }
  observe() {}
  disconnect() {
    live.intersection--;
  }
}

const g = globalThis as unknown as Record<string, unknown>;
provide(g, "MutationObserver", FakeMutationObserver);
provide(g, "ResizeObserver", FakeResizeObserver);
provide(g, "IntersectionObserver", FakeIntersectionObserver);
provide(g, "requestAnimationFrame", (callback: () => void) => setTimeout(callback, 0));
provide(g, "cancelAnimationFrame", (id: ReturnType<typeof setTimeout>) => clearTimeout(id));
if (typeof g.document === "undefined")
  provide(g, "document", {
    body: {},
    documentElement: {},
    head: { appendChild: () => {} },
    createElement: () => ({ appendChild: () => {}, setAttribute: () => {} }),
    createTextNode: () => ({}),
    getElementsByTagName: () => [],
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {},
  });

afterAll(() => {
  for (const [target, key, had, value] of saved.reverse()) {
    if (had) target[key] = value;
    else delete target[key];
  }
});

const { decideSpotlight } = await import("../src/lib/discovery/spotlight/model");
const { hotspotCandidates } = await import("../src/lib/discovery/hotspots/model");
const { RESCAN_DELAY_MS, trackAnchor, watchHotspot } = await import(
  "../src/lib/discovery/hotspots/track"
);
const { createVideoTooltipController } = await import(
  "../src/lib/discovery/video-tooltips/controller"
);
const { useFeatureVideoStore } = await import("../src/lib/feature-videos/store");
const { VideoTooltipCard } = await import(
  "../src/features/discovery/video-tooltips/video-tooltip-card"
);

import type { FeatureArea, FeatureEntry } from "../src/lib/discovery/types";

const AREAS: FeatureArea[] = ["SQL-Editor", "Dashboards", "Automatisierung", "Verbindungen"];

function catalog(size: number): FeatureEntry[] {
  return Array.from({ length: size }, (_, index) => ({
    id: `feature-${index}`,
    title: `Funktion ${index}`,
    summary: "s".repeat(120),
    area: AREAS[index % AREAS.length],
    keywords: [],
    since: `0.${index % 20}.${index % 3}`,
    size: index % 5 === 3 ? "major" : "minor",
    videoId: index % 10 === 0 ? "clip" : undefined,
  }));
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("Spotlight-Auswahl über 500 Katalogeinträge bleibt schnell", async () => {
  const entries = catalog(500);
  const now = Date.now();
  let index = 0;
  const seen = ["0.17.2", "0.12.0", "0.18.0", "0.19.1"];
  const decide = await measureScenario(() => {
    for (let run = 0; run < 20; run++)
      decideSpotlight({
        current: "0.19.1",
        seen: seen[index++ % seen.length],
        lastActive: now - (index % 2) * 30 * 86_400_000,
        now,
        onboardingDone: true,
        entries,
      });
  }, 50);
  await reportScenario("discovery-spotlight-select", {
    entries: entries.length,
    decisionsPerRun: 20,
    decide,
  });
  expect(decide.medianMs).toBeLessThan(2);
  expect(decide.p95Ms).toBeLessThan(10);
});

test("Hotspot-Positionierung mit 5 000 Knoten ohne Polling", async () => {
  const entries = catalog(500);
  const nodes = Array.from({ length: 5000 }, (_, index) => ({
    feature: `node-${index}`,
    isConnected: true,
    getBoundingClientRect: () => ({ top: 10, left: 20, width: 40, height: 20 }),
  }));
  const target = nodes[4999];
  target.feature = "feature-498";
  const find = (entry: FeatureEntry) => {
    for (const node of nodes) if (node.feature === entry.id) return node as unknown as Element;
    return null;
  };
  const originalInterval = globalThis.setInterval;
  let intervals = 0;
  globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => {
    intervals++;
    return originalInterval(...args);
  }) as typeof setInterval;
  const originalTimeout = globalThis.setTimeout;
  let rescans = 0;
  try {
    const candidates = hotspotCandidates(entries, {
      usage: {},
      dismissed: [],
      version: "0.19.0",
      easyMode: false,
    });
    const targets: (string | null)[] = [];
    const select = await measureScenario(() => {
      watchHotspot(candidates, find, () => undefined, {} as Node)();
    }, 30);
    const stop = watchHotspot(
      candidates,
      find,
      (next) => targets.push(next?.entry.id ?? null),
      {} as Node,
    );
    expect(targets).toEqual(["feature-498"]);
    globalThis.setTimeout = ((handler: () => void, ms?: number) => {
      if (ms === RESCAN_DELAY_MS) rescans++;
      return originalTimeout(handler, ms);
    }) as typeof setTimeout;
    for (let index = 0; index < 1000; index++) mutationCallback?.();
    globalThis.setTimeout = originalTimeout;
    await wait(RESCAN_DELAY_MS + 30);
    const rects: unknown[] = [];
    const untrack = trackAnchor(target as unknown as Element, (rect) => rects.push(rect));
    await wait(5);
    intersectionCallback?.([{ isIntersecting: false }]);
    await wait(5);
    const scroll = [...(windowListeners.get("scroll") ?? [])] as (() => void)[];
    for (let index = 0; index < 1000; index++) for (const listener of scroll) listener();
    await wait(5);
    const measures = rects.length;
    await wait(200);
    const idleMeasures = rects.length - measures;
    untrack();
    stop();
    await reportScenario("discovery-hotspot-position", {
      nodes: nodes.length,
      candidates: candidates.length,
      select,
      mutationBurst: 1000,
      rescans,
      scrollEvents: 1000,
      measures,
      idleMeasures,
      intervals,
    });
    expect(select.p95Ms).toBeLessThan(10);
    expect(rescans).toBe(1);
    expect(measures).toBeLessThanOrEqual(4);
    expect(rects[1]).toBeNull();
    expect(idleMeasures).toBe(0);
    expect(intervals).toBe(0);
    expect(live).toEqual({ mutation: 0, resize: 0, intersection: 0 });
    expect(windowListeners.get("scroll")?.size ?? 0).toBe(0);
    expect(windowListeners.get("resize")?.size ?? 0).toBe(0);
  } finally {
    globalThis.setInterval = originalInterval;
    globalThis.setTimeout = originalTimeout;
  }
});

test("Video-Tooltip hält höchstens ein <video>-Element", async () => {
  const anchors = Array.from(
    { length: 5000 },
    (_, index) =>
      ({
        isConnected: true,
        getAttribute: () => `feature-${(index % 50) * 10}`,
      }) as unknown as Element,
  );
  let visible = 0;
  let maxVisible = 0;
  const controller = createVideoTooltipController({
    hasClip: () => true,
    blocked: () => false,
    onChange: (next) => {
      visible = next ? 1 : 0;
      maxVisible = Math.max(maxVisible, visible);
    },
    delay: 1,
  });
  const start = performance.now();
  for (const element of anchors) controller.enter(element);
  const hoverMs = performance.now() - start;
  await wait(10);
  for (let index = 0; index < 20; index++) {
    controller.enter(anchors[index]);
    await wait(3);
  }
  controller.hide();
  Object.assign(useFeatureVideoStore.getInitialState(), {
    feed: {
      schemaVersion: 1,
      generatedAt: "",
      validUntil: "",
      items: [
        {
          id: "clip",
          poster: "p.jpg",
          sources: [
            { url: "c.mp4", type: "video/mp4", bytes: 1 },
            { url: "c.webm", type: "video/webm", bytes: 1 },
          ],
        },
      ],
    },
  });
  const markup = renderToStaticMarkup(
    createElement(VideoTooltipCard, {
      entry: catalog(1)[0],
      rect: { top: 10, left: 10, bottom: 30, right: 50, width: 40, height: 20 } as DOMRect,
    }),
  );
  const videos = markup.split("<video").length - 1;
  await reportScenario("discovery-video-tooltip", {
    anchors: anchors.length,
    hoverMs,
    maxVisible,
    videos,
    pendingAfterHide: controller.pending() !== null,
  });
  expect(maxVisible).toBe(1);
  expect(visible).toBe(0);
  expect(videos).toBe(1);
  expect(markup).not.toContain("src=");
  expect(controller.pending()).toBeNull();
  expect(hoverMs).toBeLessThan(50);
});
