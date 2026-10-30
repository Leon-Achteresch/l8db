import { heapSize } from "bun:jsc";
import { afterAll, beforeEach, expect, mock, setSystemTime, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
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

const { CHECK_INTERVAL, INPUT_EVENTS, isQuiet, readQuietSignals, watchQuiet } = await import(
  "../src/lib/blog-suggestions/quiet"
);
const { FETCH_INTERVAL, MAX_FEED_BYTES, parseBlogFeed } = await import(
  "../src/lib/blog-suggestions/model"
);
const { refreshBlogFeed, useBlogSuggestionStore } = await import(
  "../src/lib/blog-suggestions/store"
);
const { BlogSuggestionCard } = await import("../src/features/updates/blog-suggestion-card");
const { useSettingsStore } = await import("../src/lib/settings");

const SITE = "https://l8db.leon-achteresch.de";
const now = new Date(2026, 9, 24, 12).getTime();

function item(index: number) {
  const slug = `beitrag-${index}`;
  return {
    slug,
    url: `${SITE}/blog/${slug}`,
    title: `T${"i".repeat(130)}${index}`.slice(0, 140),
    summary: "s".repeat(320),
    publishedAt: "2026-10-20",
    readingMinutes: 7,
    image: `${SITE}/blog/${slug}/cover.png`,
    imageAlt: "a".repeat(240),
    tags: Array.from({ length: 20 }, (_, tag) => `${"t".repeat(36)}${tag}`),
    suggest: { until: "2026-12-31", priority: index % 7, minAppVersion: "0.16.0" },
  };
}

const feed = (count: number) => ({
  schemaVersion: 1,
  generatedAt: "2026-10-24T08:00:00Z",
  items: Array.from({ length: count }, (_, index) => item(index)),
});

function heap() {
  Bun.gc(true);
  return heapSize();
}

beforeEach(() => {
  setSystemTime(now);
  useSettingsStore.setState({ blogSuggestions: true, onboardingDone: true });
  useBlogSuggestionStore.setState({
    posts: [],
    checkedAt: 0,
    history: {},
    lastShownAt: 0,
    activeSlug: null,
  });
});

const realFetch = globalThis.fetch;
afterAll(() => {
  setSystemTime();
  globalThis.fetch = realFetch;
  if (!hadStorage) Reflect.deleteProperty(globalThis, "localStorage");
  if (!hadListeners) {
    Reflect.deleteProperty(host, "addEventListener");
    Reflect.deleteProperty(host, "removeEventListener");
  }
});

test("oversized feeds are rejected or bounded quickly", async () => {
  const thousand = feed(1000);
  const twenty = feed(20);
  const rejectThousand = await measureScenario(() => {
    expect(() => parseBlogFeed(thousand)).toThrow();
  }, 200);
  const parseTwenty = await measureScenario(() => {
    expect(parseBlogFeed(twenty)).toHaveLength(20);
  }, 200);

  const chunk = new Uint8Array(64 * 1024).fill(32);
  let pulled = 0;
  globalThis.fetch = (async () =>
    new Response(
      new ReadableStream({
        pull(controller) {
          if (pulled >= 5_000_000) controller.close();
          else {
            pulled += chunk.byteLength;
            controller.enqueue(chunk);
          }
        },
      }),
    )) as unknown as typeof fetch;
  let maxPulled = 0;
  const body = JSON.stringify(thousand);
  const bytes = new TextEncoder().encode(body);
  const before = heap();
  const streamed = await measureScenario(async () => {
    pulled = 0;
    useBlogSuggestionStore.setState({ checkedAt: 0, posts: [] });
    await refreshBlogFeed();
    maxPulled = Math.max(maxPulled, pulled);
    expect(useBlogSuggestionStore.getState().posts).toEqual([]);
  }, 40);
  globalThis.fetch = (async () => {
    let offset = 0;
    return new Response(
      new ReadableStream({
        pull(controller) {
          if (offset >= bytes.byteLength) return controller.close();
          controller.enqueue(bytes.subarray(offset, offset + chunk.byteLength));
          offset += chunk.byteLength;
        },
      }),
    );
  }) as unknown as typeof fetch;
  const thousandOverHttp = await measureScenario(async () => {
    useBlogSuggestionStore.setState({ checkedAt: 0 });
    await refreshBlogFeed();
  }, 40);
  const retainedBytes = heap() - before;

  await reportScenario("blog-feed-bounds", {
    rejectThousandItems: rejectThousand,
    parseTwentyMaxItems: parseTwenty,
    streamFiveMegabytes: streamed,
    thousandItemsOverHttp: { ...thousandOverHttp, bodyBytes: bytes.byteLength },
    maxBytesPulled: maxPulled,
    limitBytes: MAX_FEED_BYTES,
    retainedBytes,
  });
  expect(rejectThousand.medianMs).toBeLessThan(0.5);
  expect(rejectThousand.p95Ms).toBeLessThan(2);
  expect(parseTwenty.medianMs).toBeLessThan(2);
  expect(parseTwenty.p95Ms).toBeLessThan(5);
  expect(maxPulled).toBeLessThanOrEqual(MAX_FEED_BYTES + 2 * chunk.byteLength);
  expect(streamed.medianMs).toBeLessThan(20);
  expect(streamed.p95Ms).toBeLessThan(50);
  expect(thousandOverHttp.p95Ms).toBeLessThan(50);
  expect(useBlogSuggestionStore.getState().posts).toEqual([]);
  expect(retainedBytes).toBeLessThan(1_000_000);
});

test("quiet watcher keeps timers and listeners constant", async () => {
  let listeners = 0;
  let intervals = 0;
  let peakListeners = 0;
  let peakIntervals = 0;
  const previous = {
    document: globalThis.document,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
  };
  Object.assign(globalThis, {
    document: {
      hidden: false,
      hasFocus: () => true,
      activeElement: null,
      querySelectorAll: () => [],
      addEventListener: () => {
        peakListeners = Math.max(peakListeners, ++listeners);
      },
      removeEventListener: () => {
        listeners--;
      },
    },
    setInterval: () => {
      peakIntervals = Math.max(peakIntervals, ++intervals);
      return 1;
    },
    clearInterval: () => {
      intervals--;
    },
  });
  try {
    const before = heap();
    for (let cycle = 0; cycle < 1000; cycle++) watchQuiet(() => {})();
    const retainedBytes = heap() - before;
    const stop = watchQuiet(() => {});
    const active = { listeners, intervals };
    stop();
    const tick = await measureScenario(() => {
      isQuiet(readQuietSignals(now - 60_000));
    }, 2000);
    await reportScenario("blog-quiet-watch", {
      cycles: 1000,
      active,
      peakListeners,
      peakIntervals,
      afterStop: { listeners, intervals },
      checksPerHourWhileWatching: 3_600_000 / CHECK_INTERVAL,
      tick,
      retainedBytes,
    });
    expect(active).toEqual({ listeners: INPUT_EVENTS.length, intervals: 1 });
    expect(peakListeners).toBe(INPUT_EVENTS.length);
    expect(peakIntervals).toBe(1);
    expect({ listeners, intervals }).toEqual({ listeners: 0, intervals: 0 });
    expect(tick.medianMs).toBeLessThan(0.1);
    expect(tick.p95Ms).toBeLessThan(0.5);
    expect(retainedBytes).toBeLessThan(1_000_000);
  } finally {
    Object.assign(globalThis, previous);
  }
});

test("feed requests stay bounded without idle polling", async () => {
  let requests = 0;
  const body = JSON.stringify(feed(20));
  globalThis.fetch = (async () => {
    requests++;
    return new Response(body);
  }) as unknown as typeof fetch;
  for (let event = 0; event < 10_000; event++) await refreshBlogFeed();
  const afterFocusStorm = requests;
  useBlogSuggestionStore.setState({ checkedAt: 0 });
  await Promise.all(Array.from({ length: 100 }, () => refreshBlogFeed()));
  const afterConcurrent = requests;
  setSystemTime(now + FETCH_INTERVAL);
  await refreshBlogFeed();
  const afterTwelveHours = requests;
  useBlogSuggestionStore.setState({ lastShownAt: now + FETCH_INTERVAL });
  setSystemTime(now + 2 * FETCH_INTERVAL);
  await refreshBlogFeed();
  const duringCooldown = requests;
  useBlogSuggestionStore.setState({ lastShownAt: 0 });
  useSettingsStore.setState({ blogSuggestions: false });
  setSystemTime(now + 4 * FETCH_INTERVAL);
  await refreshBlogFeed();
  const whenDisabled = requests;
  await reportScenario("blog-feed-requests", {
    focusEvents: 10_000,
    afterFocusStorm,
    concurrentCalls: 100,
    afterConcurrent,
    afterTwelveHours,
    duringCooldown,
    whenDisabled,
    maxRequestsPerDay: 86_400_000 / FETCH_INTERVAL,
  });
  expect([afterFocusStorm, afterConcurrent, afterTwelveHours]).toEqual([1, 2, 3]);
  expect(duringCooldown).toBe(3);
  expect(whenDisabled).toBe(3);
});

test("at most one card is rendered with a small DOM", async () => {
  const posts = parseBlogFeed(feed(20));
  useBlogSuggestionStore.setState({ posts });
  const store = useBlogSuggestionStore.getState();
  for (let attempt = 0; attempt < 1000; attempt++) store.show(posts[attempt % 20].slug);
  const state = useBlogSuggestionStore.getState();
  let markup = "";
  const render = await measureScenario(() => {
    markup = renderToStaticMarkup(
      createElement(BlogSuggestionCard, {
        post: posts[0],
        suspended: false,
        onDismiss: () => {},
        onRead: () => {},
      }),
    );
  }, 200);
  const elements = markup.match(/<[a-z]/g)?.length ?? 0;
  await reportScenario("blog-card-dom", {
    showAttempts: 1000,
    activeCards: state.activeSlug ? 1 : 0,
    historyEntries: Object.keys(state.history).length,
    cardRoots: markup.match(/data-blog-suggestion/g)?.length ?? 0,
    elements,
    markupBytes: markup.length,
    render,
  });
  expect(state.activeSlug).toBe(posts[0].slug);
  expect(Object.keys(state.history)).toHaveLength(1);
  expect(markup.match(/data-blog-suggestion/g)).toHaveLength(1);
  expect(elements).toBeLessThanOrEqual(25);
  expect(markup.length).toBeLessThan(6000);
  expect(render.p95Ms).toBeLessThan(5);
});
