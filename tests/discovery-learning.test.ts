import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

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
let anchors: FakeElement[] = [];

interface FakeElement {
  feature: string;
  tagName: string;
  role: string | null;
  inNav: boolean;
  clicks: number;
  isConnected: boolean;
  contains: (node: unknown) => boolean;
  closest: (selector: string) => FakeElement | null;
  getAttribute: (name: string) => string | null;
  hasAttribute: (name: string) => boolean;
  getBoundingClientRect: () => { top: number; left: number; width: number; height: number };
  getClientRects: () => unknown[];
  scrollIntoView: () => void;
  click: () => void;
}

function dispatch(type: string, event: unknown) {
  for (const listener of [...(listeners.get(type) ?? [])]) listener(event);
}

function element(
  feature: string,
  { tagName = "BUTTON", role = null, inNav = false } = {} as {
    tagName?: string;
    role?: string | null;
    inNav?: boolean;
  },
): FakeElement {
  const node: FakeElement = {
    feature,
    tagName,
    role,
    inNav,
    clicks: 0,
    isConnected: true,
    contains: (other) => other === node,
    closest: (selector) => {
      if (selector === "[data-feature]") return node;
      if (selector.startsWith("nav")) return inNav ? node : null;
      return null;
    },
    getAttribute: (name) =>
      name === "data-feature" ? feature : name === "role" ? role : name === "href" ? "/x" : null,
    hasAttribute: (name) => name === "href" && tagName === "A",
    getBoundingClientRect: () => ({ top: 10, left: 10, width: 40, height: 20 }),
    getClientRects: () => [{}],
    scrollIntoView: () => {},
    click: () => {
      node.clicks++;
      dispatch("click", { target: node });
    },
  };
  return node;
}

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
      return anchors.filter((node) => node.feature === id);
    },
  },
  MutationObserver: class {
    observe() {}
    disconnect() {}
  },
  requestAnimationFrame: (callback: () => void) => setTimeout(callback, 0),
  cancelAnimationFrame: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
});

const { FEATURE_CATALOG } = await import("../src/lib/discovery/catalog");
const { atlasAvailable, atlasNewIds, atlasProgress, filterAtlas, groupAtlas } = await import(
  "../src/lib/discovery/atlas/atlas"
);
const guide = await import("../src/lib/discovery/guide");
const { useGuideStore } = await import("../src/lib/discovery/guide/engine");
const { LESSONS, lessonById } = await import("../src/lib/discovery/lessons/lessons");
const { advanceLesson, checkSatisfied, lessonAvailable, pruneLessonProgress } = await import(
  "../src/lib/discovery/lessons/progress"
);
const { useLessonsStore } = await import("../src/lib/discovery/lessons/store");
const { handleLessonSignal, resumeLesson, startLesson, endLesson } = await import(
  "../src/lib/discovery/lessons/runtime"
);
const { DEMO_ROWS, demoDatabasePath, demoSeedSql, openDemoDatabase } = await import(
  "../src/lib/discovery/lessons/demo-db"
);
const { useConnectionsStore } = await import("../src/lib/connections");
const {
  activeFeatureContext,
  aiFeatureIds,
  featureSearchContext,
  FEATURE_CONTEXT_MAX_BYTES,
  isFeatureQuestion,
} = await import("../src/lib/ai/feature-search");

import type { Capabilities } from "../src/lib/db";
import type { FeatureEntry } from "../src/lib/discovery/types";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
let path = "/query";
guide.setGuideNavigator({
  navigate: (href: string) => {
    path = href;
  },
  href: () => path,
});

function entry(id: string, extra: Partial<FeatureEntry> = {}): FeatureEntry {
  return { id, title: id, summary: id, area: "SQL-Editor", keywords: [id], ...extra };
}

const allCapabilities = new Proxy({} as Capabilities, {
  get: (_, key) => (key === "query_language" ? "sql" : true),
});

describe("atlas", () => {
  test("counts only available features", () => {
    const entries = [
      entry("a"),
      entry("b", { capability: "foreign_keys" }),
      entry("c", { hiddenInEasyMode: true }),
      entry("d", { capability: "sql" }),
    ];
    const usage = { a: { count: 1, first: 1, last: 1 }, b: { count: 2, first: 1, last: 2 } };
    const none = { query_language: "sql" } as Capabilities;
    expect(
      atlasProgress(atlasAvailable(entries, { capabilities: allCapabilities }), usage),
    ).toEqual({ used: 2, total: 4, percent: 50 });
    expect(
      atlasProgress(
        atlasAvailable(entries, { capabilities: allCapabilities, easyMode: true }),
        usage,
      ),
    ).toEqual({ used: 2, total: 3, percent: 67 });
    expect(atlasProgress(atlasAvailable(entries, { capabilities: none }), usage)).toEqual({
      used: 1,
      total: 3,
      percent: 33,
    });
    expect(atlasProgress([], usage)).toEqual({ used: 0, total: 0, percent: 0 });
  });

  test("filters and searches", () => {
    const entries = [
      entry("a", { size: "major" }),
      entry("b", { since: "9.0.0", title: "Formatieren" }),
      entry("c"),
    ];
    const usage = { a: { count: 1, first: 1, last: 1 } };
    const newIds = atlasNewIds(entries);
    const ids = (filter: "all" | "unused" | "new" | "major", query = "") =>
      filterAtlas(entries, { filter, query, usage, newIds }).map((item) => item.id);
    expect(ids("all")).toEqual(["a", "b", "c"]);
    expect(ids("unused")).toEqual(["b", "c"]);
    expect(ids("new")).toEqual(["b"]);
    expect(ids("major")).toEqual(["a"]);
    expect(ids("all", "formatieren")).toEqual(["b"]);
    expect(ids("unused", "formatieren")).toEqual(["b"]);
    expect(groupAtlas(entries).map(([area]) => area)).toEqual(["SQL-Editor"]);
    expect(groupAtlas(FEATURE_CATALOG).reduce((sum, [, list]) => sum + list.length, 0)).toBe(
      FEATURE_CATALOG.length,
    );
  });
});

describe("guide", () => {
  beforeEach(() => {
    anchors = [];
    path = "/query";
    useConnectionsStore.setState({ connections: [], activeId: null });
  });
  afterEach(() => guide.stopGuide());

  const steps = [
    { anchor: "one", title: "Eins" },
    { anchor: "two", title: "Zwei" },
  ];

  test("Weiter advances and finishes", async () => {
    anchors = [element("one"), element("two")];
    const ends: string[] = [];
    expect(guide.startGuide("x", { steps, onEnd: (reason) => ends.push(reason) })).toBe(true);
    await sleep(5);
    expect(useGuideStore.getState().guide?.phase).toBe("pointing");
    await sleep(300);
    expect(useGuideStore.getState().guide?.phase).toBe("waiting");
    guide.nextGuideStep();
    await sleep(5);
    expect(useGuideStore.getState().guide?.index).toBe(1);
    guide.nextGuideStep();
    expect(useGuideStore.getState().guide).toBeNull();
    expect(ends).toEqual(["done"]);
    expect(listeners.get("click")?.size ?? 0).toBe(0);
    expect(listeners.get("keydown")?.size ?? 0).toBe(0);
  });

  test("clicking the anchor completes the step", async () => {
    const one = element("one");
    anchors = [one, element("two")];
    guide.startGuide("x", { steps });
    await sleep(5);
    one.click();
    await sleep(5);
    expect(useGuideStore.getState().guide?.index).toBe(1);
  });

  test("Beenden and Escape end cleanly", async () => {
    anchors = [element("one")];
    const ends: string[] = [];
    guide.startGuide("x", { steps, onEnd: (reason) => ends.push(reason) });
    guide.stopGuide();
    guide.startGuide("x", { steps, onEnd: (reason) => ends.push(reason) });
    dispatch("keydown", { key: "Escape", stopPropagation() {} });
    expect(ends).toEqual(["stopped", "escape"]);
    expect(guide.isGuideRunning()).toBe(false);
  });

  test("missing anchor times out", async () => {
    const ends: string[] = [];
    guide.startGuide("x", { steps, timeoutMs: 20, onEnd: (reason) => ends.push(reason) });
    await sleep(60);
    expect(ends).toEqual(["missing"]);
    expect(useGuideStore.getState().guide).toBeNull();
  });

  test("user navigation ends the guide, step navigation does not", async () => {
    const one = element("one");
    anchors = [one, element("two")];
    const ends: string[] = [];
    guide.startGuide("x", { steps, onEnd: (reason) => ends.push(reason) });
    await sleep(5);
    one.click();
    guide.onGuideLocation("/er-diagram");
    expect(guide.isGuideRunning()).toBe(true);
    guide.stopGuide();
    guide.startGuide("x", { steps, onEnd: (reason) => ends.push(reason) });
    guide.onGuideLocation("/elsewhere");
    expect(ends).toEqual(["stopped", "navigation"]);
  });

  test("auto-click only for safe navigation outside production", async () => {
    const link = element("one", { tagName: "A" });
    anchors = [link, element("two")];
    guide.startGuide("x", { steps: [{ ...steps[0], safeClick: true }, steps[1]] });
    await sleep(5);
    expect(useGuideStore.getState().guide?.autoClick).toBe(true);
    await sleep(300);
    expect(link.clicks).toBe(1);
    expect(useGuideStore.getState().guide?.index).toBe(1);
    guide.stopGuide();

    useConnectionsStore.setState({
      connections: [
        {
          id: "p",
          name: "Prod",
          kind: "postgres",
          connectionString: "postgres://db",
          sslMode: "disable",
          ssh: null,
          environment: "production",
        },
      ],
      activeId: "p",
    });
    const prodLink = element("one", { tagName: "A" });
    anchors = [prodLink];
    guide.startGuide("x", { steps: [{ ...steps[0], safeClick: true }] });
    await sleep(300);
    expect(useGuideStore.getState().guide?.autoClick).toBe(false);
    expect(prodLink.clicks).toBe(0);
  });

  test("switching to production while the cursor moves cancels the auto-click", async () => {
    const link = element("one", { tagName: "A" });
    anchors = [link];
    guide.startGuide("x", { steps: [{ ...steps[0], safeClick: true }] });
    await sleep(5);
    expect(useGuideStore.getState().guide?.autoClick).toBe(true);
    useConnectionsStore.setState({
      connections: [
        {
          id: "p",
          name: "Prod",
          kind: "postgres",
          connectionString: "postgres://db",
          sslMode: "disable",
          ssh: null,
          environment: "production",
        },
      ],
      activeId: "p",
    });
    await sleep(300);
    expect(link.clicks).toBe(0);
    expect(useGuideStore.getState().guide?.phase).toBe("waiting");
    expect(useGuideStore.getState().guide?.autoClick).toBe(false);
  });

  test("no auto-click without safeClick or for non-navigation elements", async () => {
    const tab = element("one", { role: "tab" });
    anchors = [tab];
    guide.startGuide("x", { steps: [steps[0]] });
    await sleep(300);
    expect(tab.clicks).toBe(0);
    guide.stopGuide();
    const button = element("one");
    anchors = [button];
    guide.startGuide("x", { steps: [{ ...steps[0], safeClick: true }] });
    await sleep(300);
    expect(button.clicks).toBe(0);
    expect(useGuideStore.getState().guide?.phase).toBe("waiting");
    expect(guide.isNavigationElement(element("n", { inNav: true }) as unknown as Element)).toBe(
      true,
    );
  });

  test("features without steps do not start", () => {
    expect(guide.startGuide("does-not-exist")).toBe(false);
    const withSteps = FEATURE_CATALOG.find((item) => item.steps?.length);
    expect(withSteps && guide.guideHasSteps(withSteps.id)).toBe(true);
  });
});

describe("lessons", () => {
  test("has 5 to 7 lessons with valid steps", () => {
    expect(LESSONS.length).toBeGreaterThanOrEqual(5);
    expect(LESSONS.length).toBeLessThanOrEqual(7);
    for (const lesson of LESSONS) expect(lesson.steps.length).toBeGreaterThan(0);
  });

  test("checks match feature uses and events", () => {
    const ok = { name: "query.executed", data: { ok: true }, at: 1 };
    const failed = { name: "query.executed", data: { ok: false }, at: 1 };
    const check = { event: "query.executed", where: { ok: true } };
    expect(checkSatisfied(check, { event: ok })).toBe(true);
    expect(checkSatisfied(check, { event: failed })).toBe(false);
    expect(checkSatisfied(check, { feature: "query.run" })).toBe(false);
    expect(checkSatisfied({ feature: "explain" }, { feature: "explain" })).toBe(true);
    expect(
      checkSatisfied(
        { event: "table.filtered" },
        { event: { name: "table.filtered", data: {}, at: 1 } },
      ),
    ).toBe(true);
  });

  test("advances through steps and finishes", () => {
    const lesson = lessonById("first-query");
    if (!lesson) throw new Error("missing");
    const first = advanceLesson(lesson, undefined, { feature: "query.workspace" }, 5);
    expect(first).toEqual({ step: 1, done: false, at: 5 });
    expect(advanceLesson(lesson, first ?? undefined, { feature: "query.workspace" })).toBeNull();
    const done = advanceLesson(
      lesson,
      first ?? undefined,
      { event: { name: "query.executed", data: { ok: true }, at: 1 } },
      6,
    );
    expect(done).toEqual({ step: 2, done: true, at: 6 });
    expect(advanceLesson(lesson, done ?? undefined, { feature: "query.workspace" })).toBeNull();
  });

  test("capabilities and stored progress", () => {
    const er = lessonById("er-diagram");
    if (!er) throw new Error("missing");
    expect(lessonAvailable(er, { query_language: "sql" } as Capabilities)).toBe(false);
    expect(lessonAvailable(er, allCapabilities)).toBe(true);
    expect(
      pruneLessonProgress(
        {
          "first-query": { step: 1, done: false, at: 1 },
          nope: { step: 0, at: 1 },
          export: { step: -1, at: 1 },
        },
        (id) => lessonById(id) !== undefined,
      ),
    ).toEqual({ "first-query": { step: 1, done: false, at: 1 } });
  });

  test("demo paths work on Windows and POSIX", () => {
    expect(demoDatabasePath("C:\\Users\\Leon\\AppData\\Local\\Temp\\")).toBe(
      "C:\\Users\\Leon\\AppData\\Local\\Temp\\l8db-lernen-shop.sqlite",
    );
    expect(demoDatabasePath("C:\\Temp")).toBe("C:\\Temp\\l8db-lernen-shop.sqlite");
    expect(demoDatabasePath("/var/folders/x/T/")).toBe("/var/folders/x/T/l8db-lernen-shop.sqlite");
    expect(demoDatabasePath("C:/Temp/")).toBe("C:/Temp/l8db-lernen-shop.sqlite");
  });

  test("seed builds the shop schema with 50 to 500 rows", () => {
    const db = new Database(":memory:");
    db.exec(demoSeedSql());
    db.exec(demoSeedSql());
    for (const [table, rows] of Object.entries(DEMO_ROWS)) {
      const { count } = db.query(`SELECT count(*) AS count FROM ${table}`).get() as {
        count: number;
      };
      expect(count).toBe(rows);
      expect(count).toBeGreaterThanOrEqual(50);
      expect(count).toBeLessThanOrEqual(500);
    }
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(
      db.query("SELECT count(*) AS n FROM customers WHERE city IS NULL OR name IS NULL").get(),
    ).toEqual({ n: 0 });
    db.close();
  });

  test("demo connection is temporary, never persisted and removed on end", async () => {
    useConnectionsStore.setState({ connections: [], activeId: null });
    const saved = useConnectionsStore.getState().addConnection({
      name: "Lokal",
      kind: "postgres",
      connectionString: "postgres://localhost/app",
      sslMode: "disable",
      ssh: null,
    });
    useConnectionsStore.setState({ activeId: saved.id });
    const executed: string[] = [];
    const activated: (string | null)[] = [];
    const deps = {
      directory: async () => "C:\\Temp\\",
      execute: async (target: string) => {
        executed.push(target);
      },
      activate: async (id: string | null) => {
        activated.push(id);
        useConnectionsStore.setState({ activeId: id });
        return true;
      },
    };
    expect(await startLesson("first-query", deps)).toBe(true);
    const demo = useConnectionsStore
      .getState()
      .connections.find((connection) => connection.name === "Demo-Shop");
    expect(demo?.temporary).toBe(true);
    expect(demo?.connectionString).toBe("C:\\Temp\\l8db-lernen-shop.sqlite");
    expect(executed).toEqual(["C:\\Temp\\l8db-lernen-shop.sqlite?mode=rwc"]);
    await sleep(20);
    const stored = localStorage.getItem("l8db.connections") ?? "";
    expect(stored).toContain("postgres://localhost/app");
    expect(stored).not.toContain("l8db-lernen-shop");
    expect(useLessonsStore.getState().active?.lessonId).toBe("first-query");
    expect(localStorage.getItem("l8db.discovery.lessons") ?? "").not.toContain("connectionId");

    expect(handleLessonSignal({ feature: "query.workspace" }, 7)).toBe(true);
    expect(useLessonsStore.getState().progress["first-query"]).toEqual({
      step: 1,
      done: false,
      at: 7,
    });
    useConnectionsStore.setState({ activeId: saved.id });
    expect(
      handleLessonSignal({ event: { name: "query.executed", data: { ok: true }, at: 1 } }),
    ).toBe(false);
    useConnectionsStore.setState({ activeId: demo?.id ?? null });

    const again = await openDemoDatabase(deps);
    expect(again).toBe(demo?.id ?? "");
    await endLesson(deps);
    expect(
      useConnectionsStore.getState().connections.some((connection) => connection.id === demo?.id),
    ).toBe(false);
    expect(activated.at(-1)).toBe(saved.id);
    expect(useLessonsStore.getState().active).toBeNull();
    expect(useLessonsStore.getState().progress["first-query"]?.step).toBe(1);
  });
});

describe("lesson resume", () => {
  afterEach(() => {
    guide.stopGuide();
    useLessonsStore.setState({ active: null });
  });

  test("resuming after switching connections re-activates the demo database", async () => {
    useConnectionsStore.setState({ connections: [], activeId: null });
    useLessonsStore.setState({ progress: {} });
    const other = useConnectionsStore.getState().addConnection({
      name: "Eigene",
      kind: "postgres",
      connectionString: "postgres://localhost/eigene",
      sslMode: "disable",
      ssh: null,
    });
    const activated: (string | null)[] = [];
    const deps = {
      directory: async () => "/tmp/",
      execute: async () => undefined,
      activate: async (id: string | null) => {
        activated.push(id);
        useConnectionsStore.setState({ activeId: id });
        return true;
      },
    };
    expect(await startLesson("first-query", deps)).toBe(true);
    const demoId = useLessonsStore.getState().active?.connectionId ?? null;
    expect(demoId).not.toBeNull();
    useConnectionsStore.setState({ activeId: other.id });
    useLessonsStore.setState({
      active: { ...(useLessonsStore.getState().active as never), paused: true },
    });
    expect(handleLessonSignal({ feature: "query.workspace" })).toBe(false);
    expect(await resumeLesson(deps)).toBe(true);
    expect(useConnectionsStore.getState().activeId).toBe(demoId);
    expect(useLessonsStore.getState().active?.paused).toBe(false);
    expect(handleLessonSignal({ feature: "query.workspace" })).toBe(true);
    await endLesson(deps);
  });

  test("resuming after the demo connection vanished ends the lesson", async () => {
    useConnectionsStore.setState({ connections: [], activeId: null });
    useLessonsStore.setState({
      active: { lessonId: "first-query", connectionId: "weg", previousId: null, paused: true },
    });
    const activated: (string | null)[] = [];
    expect(
      await resumeLesson({
        activate: async (id) => {
          activated.push(id);
          return true;
        },
      }),
    ).toBe(false);
    expect(activated).toEqual([]);
    expect(useLessonsStore.getState().active).toBeNull();
  });
});

describe("ai feature search", () => {
  test("detects how-questions only", () => {
    expect(isFeatureQuestion("Wie vergleiche ich zwei Schemas?")).toBe(true);
    expect(isFeatureQuestion("wo finde ich den Verlauf")).toBe(true);
    expect(isFeatureQuestion("How do I export a table?")).toBe(true);
    expect(isFeatureQuestion("Zeig mir den Umsatz pro Monat")).toBe(false);
    expect(isFeatureQuestion("SELECT * FROM orders")).toBe(false);
  });

  test("returns bounded matches", () => {
    const context = featureSearchContext("Wie vergleiche ich zwei Schemas?");
    expect(context).toContain("schema-compare");
    expect(new TextEncoder().encode(context).length).toBeLessThanOrEqual(FEATURE_CONTEXT_MAX_BYTES);
    expect(context.split("\n").filter((line) => line.startsWith("- ")).length).toBeLessThanOrEqual(
      5,
    );
    expect(featureSearchContext("Umsatz pro Monat")).toBe("");
    const huge = Array.from({ length: 50 }, (_, index) =>
      entry(`vergleich.${index}`, { title: `Vergleich ${index}`, summary: "ä".repeat(900) }),
    );
    const bounded = featureSearchContext("wie vergleiche ich", {}, huge);
    expect(new TextEncoder().encode(bounded).length).toBeLessThanOrEqual(FEATURE_CONTEXT_MAX_BYTES);
  });

  test("without an active connection capability features stay findable", () => {
    useConnectionsStore.setState({ connections: [], activeId: null });
    expect(activeFeatureContext("Wie erstelle ich ein ER-Diagramm?")).toContain("er-diagram");
  });

  test("card ids are known and limited", () => {
    expect(aiFeatureIds("schema-compare\n- explain\nunknown\nquery.format")).toEqual([
      "schema-compare",
      "explain",
    ]);
    expect(aiFeatureIds("nope")).toEqual([]);
  });
});
