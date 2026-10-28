import { afterAll, beforeEach, describe, expect, mock, setSystemTime, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const opened: string[] = [];
mock.module("@tauri-apps/plugin-opener", () => ({
  openUrl: async (url: string) => {
    opened.push(url);
  },
}));

const host = window as unknown as Record<string, unknown>;
const previousAdd = host.addEventListener;
const hadStorage = "localStorage" in globalThis;
if (!hadStorage)
  Object.defineProperty(globalThis, "localStorage", {
    value: host.localStorage,
    configurable: true,
  });
host.addEventListener = () => {};

const { COOLDOWN, DAY, eligiblePosts, FETCH_INTERVAL, nextSuggestion, parseBlogFeed } =
  await import("../src/lib/blog-suggestions/model");
const { isQuiet, watchQuiet } = await import("../src/lib/blog-suggestions/quiet");
const { pruneBlogHistory, readBlogPost, refreshBlogFeed, useBlogSuggestionStore } = await import(
  "../src/lib/blog-suggestions/store"
);
const { BlogSuggestionCard } = await import("../src/features/updates/blog-suggestion-card");
const { useSettingsStore } = await import("../src/lib/settings");
const { useTasksStore } = await import("../src/lib/tasks");
const { websiteUrl } = await import("../src/lib/website");

import type { BlogPost } from "../src/lib/blog-suggestions/model";
import type { QuietSignals } from "../src/lib/blog-suggestions/quiet";

const SITE = "https://l8db.leon-achteresch.de";
const now = new Date(2026, 9, 24, 12).getTime();
const today = "2026-10-24";

function item(overrides: Record<string, unknown> = {}) {
  return {
    slug: "ruhige-abfragen",
    url: `${SITE}/blog/ruhige-abfragen`,
    title: "Ruhige Abfragen",
    summary: "Transaktionen und Limits im Alltag.",
    publishedAt: "2026-10-20",
    readingMinutes: 5,
    image: `${SITE}/blog/ruhige-abfragen/cover.png`,
    imageAlt: "Abfrageplan",
    tags: ["sql"],
    suggest: { until: "2026-11-30", priority: 10, minAppVersion: null },
    ...overrides,
  };
}

function feed(items: unknown[] = [item()]) {
  return { schemaVersion: 1, generatedAt: "2026-10-24T08:00:00Z", items };
}

function post(overrides: Record<string, unknown> = {}): BlogPost {
  return parseBlogFeed(feed([item(overrides)]))[0];
}

const quiet: QuietSignals = {
  visible: true,
  focused: true,
  uptime: 6 * 60_000,
  sinceInput: 31_000,
  editing: false,
  busy: false,
  overlay: false,
  onboarding: false,
  video: false,
  urgent: false,
};

const realFetch = globalThis.fetch;
beforeEach(() => {
  setSystemTime(now);
  opened.length = 0;
  localStorage.removeItem("l8db.blog-suggestions");
  useSettingsStore.setState({ blogSuggestions: true, onboardingDone: true });
  useTasksStore.setState({ tasks: [] });
  useBlogSuggestionStore.setState({
    posts: [],
    checkedAt: 0,
    history: {},
    lastShownAt: 0,
    activeSlug: null,
  });
});

afterAll(() => {
  setSystemTime();
  globalThis.fetch = realFetch;
  host.addEventListener = previousAdd;
  if (!hadStorage) Reflect.deleteProperty(globalThis, "localStorage");
});

describe("blog feed", () => {
  test("accepts the contract and keeps only suggested posts", () => {
    const posts = parseBlogFeed(
      feed([item(), item({ slug: "archiv", url: `${SITE}/blog/archiv`, suggest: null })]),
    );
    expect(posts.map((entry) => entry.slug)).toEqual(["ruhige-abfragen"]);
    expect(posts[0].url).toBe(`${SITE}/blog/ruhige-abfragen`);
    expect(websiteUrl("/blog/feed.json")).toBe(`${SITE}/blog/feed.json`);
  });

  test.each([
    ["no object", null],
    ["array", []],
    ["schema version", { ...feed(), schemaVersion: 2 }],
    ["missing items", { ...feed(), items: undefined }],
    ["more than 20 items", feed(Array.from({ length: 21 }, () => item()))],
    ["generatedAt", { ...feed(), generatedAt: "gestern" }],
  ])("rejects a structurally invalid feed (%s)", (_name, value) => {
    expect(() => parseBlogFeed(value)).toThrow();
  });

  test.each([
    { url: "https://evil.example/blog/ruhige-abfragen" },
    { url: "https://l8db.leon-achteresch.de.evil.example/blog/x" },
    { url: "http://l8db.leon-achteresch.de/blog/x" },
    { url: "https://user:pw@l8db.leon-achteresch.de/blog/x" },
    { url: `${SITE}/admin` },
    { url: `${SITE}/blog/` },
    { url: `${SITE}/blog/../admin` },
    { url: "/blog/ruhige-abfragen" },
    { url: "javascript:alert(1)" },
    { image: "http://l8db.leon-achteresch.de/cover.png" },
    { image: "https://cdn.example/cover.png" },
    { image: "data:image/png;base64,AAAA" },
    { image: 42 },
    { imageAlt: 5 },
    { slug: "../etc" },
    { slug: "Grossbuchstaben" },
    { title: "" },
    { title: "   " },
    { title: "a".repeat(141) },
    { title: "Zeile\numbruch" },
    { title: "Spoof‮gnp.exe" },
    { summary: { html: "<b>x</b>" } },
    { summary: "a".repeat(321) },
    { publishedAt: "2026-13-01" },
    { publishedAt: "2026-02-30" },
    { publishedAt: "gestern" },
    { readingMinutes: 0 },
    { readingMinutes: 1.5 },
    { readingMinutes: "5" },
    { readingMinutes: 241 },
    { tags: "sql" },
    { tags: Array.from({ length: 21 }, () => "x") },
    { tags: [1] },
    { suggest: undefined },
    { suggest: { until: "bald", priority: 1, minAppVersion: null } },
    { suggest: { until: "2026-11-30", priority: 1.5, minAppVersion: null } },
    { suggest: { until: "2026-11-30", priority: 1, minAppVersion: "latest" } },
    { suggest: { until: "2026-11-30", priority: 1 } },
  ])("skips an unsafe or malformed item %j", (patch) => {
    expect(
      parseBlogFeed(feed([item(patch), item({ slug: "ok", url: `${SITE}/blog/ok` })])),
    ).toEqual([expect.objectContaining({ slug: "ok" })]);
  });

  test("keeps the first of duplicate slugs and accepts posts without image", () => {
    const posts = parseBlogFeed(
      feed([
        item({ title: "Erster" }),
        item({ title: "Zweiter" }),
        item({ slug: "ohne", url: `${SITE}/blog/ohne`, image: null, imageAlt: null }),
      ]),
    );
    expect(posts.map((entry) => entry.title)).toEqual(["Erster", "Ruhige Abfragen"]);
    expect(posts[1].image).toBeNull();
  });

  test("treats markup as plain text", () => {
    const markup = renderToStaticMarkup(
      createElement(BlogSuggestionCard, {
        post: post({ title: "<img src=x onerror=alert(1)>", summary: "<script>alert(1)</script>" }),
        suspended: false,
        onDismiss: () => {},
        onRead: () => {},
      }),
    );
    expect(markup).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(markup).not.toContain("<script>");
    expect(markup.match(/<img /g)).toHaveLength(1);
  });
});

describe("selection", () => {
  test("orders by priority, then recency, then slug", () => {
    const posts = [
      post({ slug: "alt", url: `${SITE}/blog/alt`, publishedAt: "2026-09-01" }),
      post({ slug: "neu", url: `${SITE}/blog/neu`, publishedAt: "2026-10-22" }),
      post({
        slug: "wichtig",
        url: `${SITE}/blog/wichtig`,
        publishedAt: "2026-08-01",
        suggest: { until: "2026-12-01", priority: 50, minAppVersion: null },
      }),
    ];
    expect(eligiblePosts(posts, {}, "0.16.0", now).map((entry) => entry.slug)).toEqual([
      "wichtig",
      "neu",
      "alt",
    ]);
  });

  test("respects until inclusively and ignores future posts", () => {
    const suggest = (until: string) => ({ until, priority: 1, minAppVersion: null });
    expect(eligiblePosts([post({ suggest: suggest(today) })], {}, null, now)).toHaveLength(1);
    expect(eligiblePosts([post({ suggest: suggest("2026-10-23") })], {}, null, now)).toEqual([]);
    expect(eligiblePosts([post({ publishedAt: "2026-10-25" })], {}, null, now)).toEqual([]);
  });

  test("applies minAppVersion semantically and counts canaries as their release", () => {
    const gated = [
      post({ suggest: { until: "2026-12-01", priority: 1, minAppVersion: "0.16.0" } }),
    ];
    expect(eligiblePosts(gated, {}, null, now)).toEqual([]);
    expect(eligiblePosts(gated, {}, "0.15.9", now)).toEqual([]);
    expect(eligiblePosts(gated, {}, "0.16.0-canary.5", now)).toHaveLength(1);
    expect(eligiblePosts(gated, {}, "0.16.10", now)).toHaveLength(1);
    expect(eligiblePosts([post()], {}, null, now)).toHaveLength(1);
  });

  test("shows each post once and at most one card every three days", () => {
    const posts = [post()];
    expect(nextSuggestion(posts, {}, now - COOLDOWN + 1, null, now)).toBeNull();
    expect(nextSuggestion(posts, {}, now - COOLDOWN, null, now)?.slug).toBe("ruhige-abfragen");
    expect(
      nextSuggestion(posts, { "ruhige-abfragen": { status: "seen", at: 1 } }, 0, null, now),
    ).toBeNull();
  });
});

describe("quiet conditions", () => {
  test("requires every quiet signal", () => {
    expect(isQuiet(quiet)).toBe(true);
    for (const patch of [
      { visible: false },
      { focused: false },
      { uptime: 4 * 60_000 },
      { sinceInput: 29_000 },
      { editing: true, sinceInput: 60_000 },
      { busy: true },
      { overlay: true },
      { onboarding: true },
      { video: true },
      { urgent: true },
    ])
      expect(isQuiet({ ...quiet, ...patch })).toBe(false);
    expect(isQuiet({ ...quiet, editing: true, sinceInput: 121_000 })).toBe(true);
  });

  test("watcher reads live signals and resets on input", () => {
    const listeners = new Map<string, () => void>();
    let tick: (() => void) | undefined;
    let overlay = false;
    const previous = { document: globalThis.document, setInterval: globalThis.setInterval };
    Object.assign(globalThis, {
      document: {
        hidden: false,
        hasFocus: () => true,
        activeElement: null,
        querySelectorAll: () => (overlay ? [{ getClientRects: () => [1] }] : []),
        addEventListener: (type: string, listener: () => void) => listeners.set(type, listener),
        removeEventListener: (type: string) => listeners.delete(type),
      },
      setInterval: (callback: () => void) => {
        tick ??= callback;
        return 1;
      },
    });
    try {
      setSystemTime(performance.timeOrigin + 10 * 60_000);
      let calls = 0;
      const stop = watchQuiet(() => calls++);
      setSystemTime(performance.timeOrigin + 11 * 60_000);
      tick?.();
      expect(calls).toBe(1);
      listeners.get("keydown")?.();
      tick?.();
      expect(calls).toBe(1);
      setSystemTime(performance.timeOrigin + 12 * 60_000);
      overlay = true;
      tick?.();
      useTasksStore.setState({
        tasks: [
          { id: "q", title: "SQL-Abfrage", startedAt: 0, status: "running", cancellable: true },
        ],
      });
      overlay = false;
      tick?.();
      useTasksStore.setState({ tasks: [] });
      useSettingsStore.setState({ onboardingDone: false });
      tick?.();
      expect(calls).toBe(1);
      useSettingsStore.setState({ onboardingDone: true });
      tick?.();
      expect(calls).toBe(2);
      stop();
      expect(listeners.size).toBe(0);
    } finally {
      Object.assign(globalThis, previous);
    }
  });
});

describe("frequency and store", () => {
  test("shows a single card and remembers every outcome", () => {
    const store = useBlogSuggestionStore.getState();
    store.show("eins");
    store.show("zwei");
    expect(useBlogSuggestionStore.getState().activeSlug).toBe("eins");
    expect(useBlogSuggestionStore.getState().lastShownAt).toBe(now);
    store.finish("eins", "dismissed");
    expect(useBlogSuggestionStore.getState()).toMatchObject({
      activeSlug: null,
      history: { eins: { status: "dismissed", at: now } },
    });
    store.show("zwei");
    expect(useBlogSuggestionStore.getState().activeSlug).toBeNull();
    setSystemTime(now + COOLDOWN);
    store.show("eins");
    expect(useBlogSuggestionStore.getState().activeSlug).toBeNull();
    store.show("zwei");
    expect(useBlogSuggestionStore.getState().activeSlug).toBe("zwei");
  });

  test("prunes history to a bounded, valid set", () => {
    const history = Object.fromEntries(
      Array.from({ length: 500 }, (_, index) => [
        `p-${index}`,
        { status: "seen", at: now - index },
      ]),
    );
    const pruned = pruneBlogHistory(
      {
        ...history,
        "../x": { status: "seen", at: now },
        alt: { status: "seen", at: now - 800 * DAY },
        bad: { status: "hidden", at: now },
      },
      now,
    );
    expect(Object.keys(pruned)).toHaveLength(200);
    expect(pruned["p-0"]).toBeDefined();
    expect(pruned["../x"]).toBeUndefined();
  });
});

describe("multiple windows", () => {
  test("persists shown state for other windows", () => {
    useBlogSuggestionStore.setState({ posts: [post()] });
    useBlogSuggestionStore.getState().show("ruhige-abfragen");
    const saved = useBlogSuggestionStore.persist
      .getOptions()
      .storage?.getItem("l8db.blog-suggestions") as {
      state: {
        lastShownAt: number;
        history: Record<string, { status: string }>;
        activeSlug?: string;
      };
    };
    expect(saved.state.lastShownAt).toBe(now);
    expect(saved.state.history["ruhige-abfragen"].status).toBe("seen");
    expect(saved.state.activeSlug).toBeUndefined();
  });

  test("adopts another window's shown card and drops tampered posts", () => {
    useBlogSuggestionStore.setState({
      posts: [post(), post({ slug: "zwei", url: `${SITE}/blog/zwei` })],
    });
    useBlogSuggestionStore.persist.getOptions().storage?.setItem("l8db.blog-suggestions", {
      state: {
        posts: [item(), item({ slug: "boese", url: "https://evil.example/blog/boese" })],
        checkedAt: now,
        history: { "ruhige-abfragen": { status: "seen", at: now } },
        lastShownAt: now,
      },
      version: 0,
    } as never);
    useBlogSuggestionStore.persist.rehydrate();
    const state = useBlogSuggestionStore.getState();
    expect(state.posts.map((entry) => entry.slug)).toEqual(["ruhige-abfragen"]);
    expect(state.lastShownAt).toBe(now);
    expect(nextSuggestion(state.posts, state.history, state.lastShownAt, null, now)).toBeNull();
    state.show("zwei");
    expect(useBlogSuggestionStore.getState().activeSlug).toBeNull();
  });
});

describe("reading", () => {
  test("opens the article in the system browser and marks it read", async () => {
    const entry = post();
    useBlogSuggestionStore.setState({ posts: [entry] });
    useBlogSuggestionStore.getState().show(entry.slug);
    await readBlogPost(entry);
    expect(opened).toEqual([`${SITE}/blog/ruhige-abfragen`]);
    expect(useBlogSuggestionStore.getState()).toMatchObject({
      activeSlug: null,
      history: { "ruhige-abfragen": { status: "read" } },
    });
  });

  test("never opens a URL outside the website blog", async () => {
    await readBlogPost({ ...post(), url: "https://evil.example/blog/x" });
    expect(opened).toEqual([]);
  });

  test("renders an accessible card with and without image", () => {
    const render = (entry: BlogPost) =>
      renderToStaticMarkup(
        createElement(BlogSuggestionCard, {
          post: entry,
          suspended: false,
          onDismiss: () => {},
          onRead: () => {},
        }),
      );
    const withImage = render(post());
    expect(withImage.match(/data-blog-suggestion/g)).toHaveLength(1);
    expect(withImage).toContain('alt="Abfrageplan"');
    expect(withImage).toContain('referrerPolicy="no-referrer"');
    expect(withImage).toContain('aria-label="Blog-Vorschlag schließen"');
    expect(withImage).toContain("5 Min. Lesezeit");
    expect(withImage).toMatch(/aria-labelledby="([^"]+)"[\s\S]*id="\1"/);
    const plain = render(post({ image: null, imageAlt: null }));
    expect(plain).not.toContain("<img");
    expect(plain).toContain("Lesen");
    expect(plain).toContain('aria-label="Blog-Vorschlag schließen"');
  });
});

describe("feed refresh", () => {
  const respond = (body: string, status = 200) => {
    const calls: { url: string; init: RequestInit }[] = [];
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(body, { status });
    }) as unknown as typeof fetch;
    return calls;
  };

  test("loads the feed once per 12 hours without credentials", async () => {
    const calls = respond(JSON.stringify(feed()));
    await refreshBlogFeed();
    await refreshBlogFeed();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${SITE}/blog/feed.json`);
    expect(calls[0].init).toMatchObject({ credentials: "omit", cache: "no-cache" });
    expect(useBlogSuggestionStore.getState().posts).toHaveLength(1);
    setSystemTime(now + FETCH_INTERVAL);
    await refreshBlogFeed();
    expect(calls).toHaveLength(2);
  });

  test("stays silent and clears posts for missing or broken feeds", async () => {
    for (const [body, status] of [
      ["", 404],
      ["{kaputt", 200],
      [JSON.stringify({ ...feed(), schemaVersion: 9 }), 200],
    ] as const) {
      useBlogSuggestionStore.setState({ posts: [post()], checkedAt: 0 });
      respond(body, status);
      await refreshBlogFeed();
      expect(useBlogSuggestionStore.getState().posts).toEqual([]);
    }
  });

  test("keeps cached posts on network errors", async () => {
    useBlogSuggestionStore.setState({ posts: [post()] });
    globalThis.fetch = (async () => {
      throw new TypeError("offline");
    }) as unknown as typeof fetch;
    await refreshBlogFeed();
    expect(useBlogSuggestionStore.getState().posts).toHaveLength(1);
    expect(useBlogSuggestionStore.getState().checkedAt).toBe(now);
  });

  test("does not fetch when disabled, cooling down or aborted", async () => {
    const calls = respond(JSON.stringify(feed()));
    useSettingsStore.setState({ blogSuggestions: false });
    await refreshBlogFeed();
    useSettingsStore.setState({ blogSuggestions: true });
    useBlogSuggestionStore.setState({ lastShownAt: now - DAY });
    await refreshBlogFeed();
    useBlogSuggestionStore.setState({ lastShownAt: 0 });
    const controller = new AbortController();
    controller.abort();
    await refreshBlogFeed(controller.signal);
    expect(calls).toHaveLength(0);
  });

  test("abort on unmount cancels the request and allows a later retry", async () => {
    let signal: AbortSignal | undefined;
    globalThis.fetch = ((_url: string, init: RequestInit) => {
      signal = init.signal ?? undefined;
      return new Promise((_resolve, reject) =>
        signal?.addEventListener("abort", () => reject(new DOMException("abort", "AbortError"))),
      );
    }) as unknown as typeof fetch;
    const controller = new AbortController();
    const pending = refreshBlogFeed(controller.signal);
    controller.abort();
    await pending;
    expect(signal?.aborted).toBe(true);
    expect(useBlogSuggestionStore.getState().checkedAt).toBe(0);
  });
});
