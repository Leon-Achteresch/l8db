import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  setDefaultTimeout,
  test,
} from "bun:test";
import { type Browser, type CDPSession, chromium, type Page, webkit } from "playwright";
import type { ViteDevServer } from "vite";
import { seedApp } from "./fixtures/perf-app";

const ENABLED = Boolean(process.env.L8DB_ISLAND_PERF);
const WEBKIT = process.env.L8DB_PERF_ENGINE === "webkit";
const RATE = WEBKIT ? 1 : Number(process.env.L8DB_PERF_CPU_RATE ?? 4);
const FRAME_P95_MS = Number(process.env.L8DB_PERF_FRAME_P95 ?? (WEBKIT ? 20 : 17.5));
const FRAME_WORST_MS = Number(process.env.L8DB_PERF_FRAME_WORST ?? 120);
const SCALE = Number(process.env.L8DB_ISLAND_BUDGET_SCALE ?? 1) * (RATE / 4);
const BACKLOG_MS = 1600;
const QUEUE_LIMIT = 6;
const MAX_TOASTS = 5;

setDefaultTimeout(90000);

type Metrics = Record<string, number>;
type Sample = {
  p95: number;
  worst: number;
  frames: number;
  commits: number;
  drops: number;
  leaves: number;
  islandKeys: string[];
  maxNodes: number;
  script: number;
  style: number;
  styleCount: number;
  layoutCount: number;
};

let browser: Browser;
let page: Page;
let cdp: CDPSession | null = null;
let server: ViteDevServer;
const errors: string[] = [];

async function metrics(): Promise<Metrics> {
  if (!cdp) return {};
  const { metrics } = await cdp.send("Performance.getMetrics");
  return Object.fromEntries(metrics.map((entry) => [entry.name, entry.value]));
}

function run(expression: string) {
  return page.evaluate(expression);
}

async function sample(action: () => Promise<void>): Promise<Sample> {
  await page.evaluate(() => {
    const probe = window as unknown as IslandProbe;
    probe.__frames = [];
    probe.__last = performance.now();
    probe.__commits = 0;
    probe.__drops = 0;
    probe.__leaves = 0;
    probe.__islandKeys = [];
    probe.__maxNodes = document.getElementsByTagName("*").length;
    const tick = (now: number) => {
      probe.__frames.push(now - probe.__last);
      probe.__last = now;
      probe.__maxNodes = Math.max(probe.__maxNodes, document.getElementsByTagName("*").length);
      probe.__raf = requestAnimationFrame(tick);
    };
    probe.__raf = requestAnimationFrame(tick);
  });
  const before = await metrics();
  await action();
  const after = await metrics();
  const result = await page.evaluate(() => {
    const probe = window as unknown as IslandProbe;
    cancelAnimationFrame(probe.__raf);
    const frames = probe.__frames.slice(1);
    const sorted = [...frames].sort((a, b) => a - b);
    return {
      p95: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
      worst: Math.max(0, ...frames),
      frames: frames.length,
      commits: probe.__commits,
      drops: probe.__drops,
      leaves: probe.__leaves,
      islandKeys: probe.__islandKeys,
      maxNodes: probe.__maxNodes,
    };
  });
  const delta = (key: string) => (after[key] ?? 0) - (before[key] ?? 0);
  return {
    ...result,
    script: delta("ScriptDuration") * 1000,
    style: delta("RecalcStyleDuration") * 1000,
    styleCount: delta("RecalcStyleCount"),
    layoutCount: delta("LayoutCount"),
  };
}

function report(name: string, result: Sample) {
  console.log(
    `island-perf ${name}: p95 ${result.p95.toFixed(1)} ms, worst ${result.worst.toFixed(0)} ms, commits ${result.commits}, drops ${result.drops}/${result.leaves}, script ${result.script.toFixed(0)} ms, style ${result.style.toFixed(0)} ms/${result.styleCount}, layouts ${result.layoutCount}, nodes ${result.maxNodes}`,
  );
}

function expectSmooth(result: Sample) {
  expect(result.p95).toBeLessThanOrEqual(FRAME_P95_MS);
  expect(result.worst).toBeLessThanOrEqual(FRAME_WORST_MS);
}

function expectWork(result: Sample, budget: { script?: number; styleCount?: number }) {
  if (!cdp) return;
  if (budget.script !== undefined) expect(result.script).toBeLessThanOrEqual(budget.script * SCALE);
  if (budget.styleCount !== undefined)
    expect(result.styleCount).toBeLessThanOrEqual(budget.styleCount);
}

function activeToasts() {
  return page.locator('[data-sonner-toast]:not([data-removed="true"])').count();
}

function shownKeys() {
  return page.evaluate(() =>
    [...document.querySelectorAll("[data-island]")].map((node) => node.getAttribute("data-island")),
  );
}

function waitForIdle(timeout = 10000) {
  return page.waitForFunction(
    () =>
      [...document.querySelectorAll("[data-island]")].every(
        (node) => node.getAttribute("data-island") === "idle",
      ),
    undefined,
    { timeout },
  );
}

function queueLength() {
  return page.evaluate(
    () => (window as unknown as IslandProbe).__island.useIslandStore.getState().queue.length,
  );
}

function runningAnimations(selector: string) {
  return page.evaluate(
    (target) =>
      document.getAnimations().filter((animation) => {
        const effect = animation.effect as KeyframeEffect | null;
        return (
          animation.playState === "running" &&
          effect?.target instanceof Element &&
          Boolean(effect.target.closest(target))
        );
      }).length,
    selector,
  );
}

async function settle() {
  await run(`(() => {
    __island.useIslandStore.setState({ queue: [] });
    __sonner.toast.dismiss();
    __tasks.useTasksStore.setState({ tasks: [] });
    __settings.useSettingsStore.setState({ dynamicIsland: true });
    clearInterval(window.__progress);
  })()`);
  await page.mouse.move(5, 600);
  await page.waitForFunction(
    () =>
      !document.querySelector("[data-sonner-toast]") &&
      !document.querySelector("[data-toast-drop]"),
    undefined,
    { timeout: 10000 },
  );
  await waitForIdle();
  await page.waitForTimeout(1200);
}

function moment(key: string) {
  return `__island.showIslandMoment({ key: ${key}, glyph: { kind: "check" }, title: "Moment " + ${key}, tone: "success", duration: 4000 })`;
}

type SonnerProbe = { __sonner: { toast: { getToasts: () => unknown[] } } };

type IslandProbe = {
  __frames: number[];
  __last: number;
  __raf: number;
  __commits: number;
  __drops: number;
  __leaves: number;
  __islandKeys: string[];
  __maxNodes: number;
  __island: { useIslandStore: { getState: () => { queue: { key: string }[] } } };
};

beforeAll(async () => {
  if (!ENABLED) return;
  process.env.NODE_ENV = "production";
  const { createServer } = await import("vite");
  server = await createServer({
    mode: "production",
    cacheDir: "node_modules/.vite-island-perf",
    logLevel: "error",
    server: { host: "127.0.0.1", port: 0, strictPort: false, watch: null, hmr: false },
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") throw new Error("Vite-Server ohne Port");
  browser = await (WEBKIT ? webkit : chromium).launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(30000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const probe = window as unknown as IslandProbe & Record<string, unknown>;
    probe.__commits = 0;
    probe.__drops = 0;
    probe.__leaves = 0;
    probe.__islandKeys = [];
    probe.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      supportsFiber: true,
      renderers: new Map(),
      inject: () => 1,
      onCommitFiberRoot: () => {
        probe.__commits += 1;
      },
      onCommitFiberUnmount: () => {},
      onPostCommitFiberRoot: () => {},
      checkDCE: () => {},
    };
    new MutationObserver((records) => {
      for (const record of records)
        for (const node of record.addedNodes) {
          if (!(node instanceof HTMLElement)) continue;
          const drop = node.dataset.toastDrop;
          if (drop === "enter") probe.__drops += 1;
          if (drop === "leave") probe.__leaves += 1;
          const key = node.dataset.island;
          if (key) probe.__islandKeys.push(key);
        }
    }).observe(document, { subtree: true, childList: true });
  });
  await seedApp(page, 50);
  await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('a[data-name="table_0000"]', { timeout: 180000 });
  await page.waitForSelector("[data-island]", { timeout: 30000 });
  await page.evaluate(async () => {
    const url = performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .find((name) => name.includes("/deps/sonner.js"));
    if (!url) throw new Error("sonner-Modul nicht gefunden");
    Object.assign(window, {
      __sonner: await import(url),
      __island: await import("/src/lib/dynamic-island.ts"),
      __tasks: await import("/src/lib/tasks.ts"),
      __settings: await import("/src/lib/settings.ts"),
    });
  });
  if (!WEBKIT) {
    cdp = await page.context().newCDPSession(page);
    await cdp.send("Performance.enable");
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: RATE });
  }
  await settle();
}, 300000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

beforeEach(async () => {
  if (!ENABLED) return;
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await settle();
});

describe.skipIf(!ENABLED)("Dynamic Island Performance", () => {
  test("Leerlauf weckt weder React noch die Style-Engine", async () => {
    const result = await sample(() => page.waitForTimeout(2500));
    report("Leerlauf", result);
    expect(result.commits).toBeLessThanOrEqual(1);
    expectWork(result, { styleCount: 2 });
    expectSmooth(result);
  });

  for (const [name, glyph] of [
    ["Emoji-Pop", `{ kind: "emoji", emoji: "🎉", effect: "pop" }`],
    ["Emoji-Wink", `{ kind: "emoji", emoji: "👋", effect: "wave" }`],
    ["Häkchen", `{ kind: "check" }`],
    ["Kreuz", `{ kind: "cross" }`],
    ["Ring", `{ kind: "ring", percent: 42 }`],
    ["Punkt", `{ kind: "dot", color: "#f59e0b" }`],
    ["Welle", `{ kind: "wave" }`],
  ] as const) {
    test(`Einzelner Moment (${name}) läuft flüssig und räumt seine Animationen ab`, async () => {
      const result = await sample(async () => {
        await run(
          `__island.showIslandMoment({ key: "single", glyph: ${glyph}, title: "Ein ziemlich langer Titel für die Island", detail: "Detailtext", tone: "celebrate", duration: 1500, more: 3 })`,
        );
        await page.waitForFunction(() => document.querySelector('[data-island="single"]'));
        await waitForIdle();
        await page.waitForTimeout(800);
      });
      report(`Moment ${name}`, result);
      expectSmooth(result);
      expectWork(result, { script: 120 });
      expect(await runningAnimations("[data-tour=header-search]")).toBe(0);
      expect(result.islandKeys).toContain("single");
    });
  }

  test("Moment-Flut (200 synchron) begrenzt die Queue und unterbricht den sichtbaren Moment nicht", async () => {
    await run(moment(`"head"`));
    await page.waitForFunction(() => document.querySelector('[data-island="head"]'));
    const result = await sample(async () => {
      await run(`for (let i = 0; i < 200; i++) ${moment('"flood-" + i')}`);
      await page.waitForTimeout(600);
    });
    report("Moment-Flut", result);
    expect(await queueLength()).toBe(QUEUE_LIMIT);
    expect(await shownKeys()).toEqual(["head"]);
    expect(result.islandKeys).toEqual([]);
    expect(result.commits).toBeLessThanOrEqual(6);
    expectSmooth(result);
    expectWork(result, { script: 80 });
  });

  test("Moment-Stream (4/s) wechselt den sichtbaren Moment höchstens im Backlog-Takt", async () => {
    const started = Date.now();
    const result = await sample(async () => {
      for (let i = 0; i < 24; i++) {
        await run(moment(`"stream-${i}"`));
        await page.waitForTimeout(250);
      }
    });
    const elapsed = Date.now() - started;
    report("Moment-Stream", result);
    expect(result.islandKeys.length).toBeLessThanOrEqual(Math.ceil(elapsed / BACKLOG_MS) + 1);
    expect(await queueLength()).toBeLessThanOrEqual(QUEUE_LIMIT);
    expect(result.commits).toBeLessThanOrEqual(40);
    expectSmooth(result);
    expectWork(result, { script: 100, styleCount: 300 });
  });

  test("Backlog verkürzt die Anzeigedauer, Momente mit Aktion bleiben voll stehen", async () => {
    const started = Date.now();
    await run(`for (let i = 0; i < 4; i++) ${moment('"backlog-" + i')}`);
    await waitForIdle(15000);
    const drained = Date.now() - started;
    expect(drained).toBeLessThan(4 * 4000);
    expect(drained).toBeLessThan(4 * BACKLOG_MS + 3000);

    await run(
      `__island.showIslandMoment({ key: "action", glyph: { kind: "check" }, title: "Neu", duration: 3000, action: { label: "Öffnen", run: () => {} } })`,
    );
    await run(moment(`"after-action"`));
    await page.waitForTimeout(BACKLOG_MS + 600);
    expect(await shownKeys()).toEqual(["action"]);
  });

  test("Hover hält den Moment an, Verlassen setzt den Timer fort", async () => {
    await run(
      `__island.showIslandMoment({ key: "hover", glyph: { kind: "check" }, title: "Hover", duration: 800 })`,
    );
    await page.waitForFunction(() => document.querySelector('[data-island="hover"]'));
    const box = await page.locator("[data-tour=header-search]").boundingBox();
    if (!box) throw new Error("Island nicht sichtbar");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(1600);
    expect(await shownKeys()).toEqual(["hover"]);
    await page.mouse.move(5, 600);
    await waitForIdle(5000);
  });

  test("Gleicher Key ersetzt den Moment statt zu stapeln", async () => {
    for (let i = 0; i < 50; i++) await run(moment(`"same"`));
    expect(await queueLength()).toBe(1);
  });

  for (const [count, p95, worst, script] of [
    [10, FRAME_P95_MS, FRAME_WORST_MS, 120],
    [50, FRAME_P95_MS, 200, 250],
  ] as const) {
    test(`Toast-Burst (${count}) startet ein Drop-Overlay und hält höchstens ${MAX_TOASTS} Toasts`, async () => {
      const result = await sample(async () => {
        await run(
          `for (let i = 0; i < ${count}; i++) __sonner.toast.error("Fehler " + i, { description: "Etwas ging schief" })`,
        );
        expect(
          await page.evaluate(
            () => (window as unknown as SonnerProbe).__sonner.toast.getToasts().length,
          ),
        ).toBeLessThanOrEqual(MAX_TOASTS);
        await page.waitForFunction(
          (limit) =>
            document.querySelectorAll('[data-sonner-toast]:not([data-removed="true"])').length <=
            limit,
          MAX_TOASTS,
          { timeout: 4000 },
        );
        await page.waitForTimeout(2000);
      });
      report(`Toast-Burst ${count}`, result);
      expect(result.drops).toBe(1);
      expect(result.leaves).toBeLessThanOrEqual(1);
      expect(result.commits).toBeLessThanOrEqual(count + 15);
      expect(result.p95).toBeLessThanOrEqual(p95);
      expect(result.worst).toBeLessThanOrEqual(worst);
      expectWork(result, { script });
    });
  }

  test(`Dauerhafte Toasts stapeln sich nicht über ${MAX_TOASTS} hinaus`, async () => {
    for (let i = 0; i < 12; i++) {
      await run(`__sonner.toast.warning("Bleibt ${i}", { duration: Infinity })`);
      await page.waitForTimeout(120);
    }
    await page.waitForTimeout(1200);
    expect(await activeToasts()).toBe(MAX_TOASTS);
    expect(await page.locator("[data-sonner-toast]").first().textContent()).toContain("Bleibt 11");
  });

  test("Toast-Stream (4/s) lässt nur den ersten Toast tropfen", async () => {
    const result = await sample(async () => {
      for (let i = 0; i < 20; i++) {
        await run(`__sonner.toast("Nachricht ${i}")`);
        await page.waitForTimeout(250);
      }
      await page.waitForTimeout(3500);
    });
    report("Toast-Stream", result);
    expect(result.drops).toBe(1);
    expect(result.leaves).toBeLessThanOrEqual(1);
    expectSmooth(result);
    expectWork(result, { script: 320, styleCount: 700 });
  });

  test("Nach einer Ruhepause tropft ein einzelner Toast wieder", async () => {
    const result = await sample(async () => {
      await run(`__sonner.toast.success("Erster")`);
      await page.waitForTimeout(3600);
      await run(`__sonner.toast.success("Zweiter")`);
      await page.waitForTimeout(3600);
    });
    report("Toast-Pause", result);
    expect(result.drops).toBe(2);
    expect(result.leaves).toBe(2);
    expectSmooth(result);
  });

  test("Schließen mitten im Drop räumt das Overlay sofort ab", async () => {
    await run(`__sonner.toast.success("Weg damit")`);
    await page.waitForSelector("[data-toast-drop]");
    await run(`__sonner.toast.dismiss()`);
    await page.waitForFunction(() => !document.querySelector("[data-toast-drop]"), undefined, {
      timeout: 2000,
    });
    await page.waitForFunction(() => !document.querySelector("[data-sonner-toast]"));
  });

  test("Task-Fortschritt ohne Total (20/s) rendert die Island nicht neu", async () => {
    await run(
      `window.__task = __tasks.startTask({ title: "SQL-Abfrage", connectionName: "perf" })`,
    );
    await page.waitForFunction(() => document.querySelector("[data-island^='task:']"));
    await page.waitForTimeout(500);
    const result = await sample(async () => {
      await run(
        `(() => { let rows = 0; window.__progress = setInterval(() => __tasks.updateTask(window.__task, { progress: (rows += 500) }), 50); })()`,
      );
      await page.waitForTimeout(3000);
      await run(`clearInterval(window.__progress)`);
    });
    report("Task-Zeilen", result);
    expect(result.commits).toBeLessThanOrEqual(6);
    expectSmooth(result);
  });

  test("Task-Fortschritt mit Total rendert nur bei Prozentwechsel", async () => {
    await run(`window.__task = __tasks.startTask({ title: "Export", total: 100000 })`);
    await page.waitForFunction(() => document.querySelector("[data-island^='task:']"));
    const result = await sample(async () => {
      await run(
        `(() => { let done = 0; window.__progress = setInterval(() => __tasks.updateTask(window.__task, { progress: (done += 50) }), 50); })()`,
      );
      await page.waitForTimeout(3000);
      await run(`clearInterval(window.__progress)`);
    });
    report("Task-Prozent", result);
    expect(result.commits).toBeLessThanOrEqual(10);
    expect(await page.locator("[data-island^='task:']").textContent()).toMatch(/\d+\s?%/);
    expectSmooth(result);
  });

  test("50 parallele Tasks zeigen eine Welle mit Zähler", async () => {
    const result = await sample(async () => {
      await run(`for (let i = 0; i < 50; i++) __tasks.startTask({ title: "Job " + i })`);
      await page.waitForFunction(() => document.querySelector("[data-island^='task:']"));
      await page.waitForTimeout(2500);
    });
    report("50 Tasks", result);
    expect(await page.locator("[data-island^='task:']").textContent()).toContain("+49");
    expect(await page.locator("[data-island^='task:'] .rounded-full.bg-current").count()).toBe(5);
    expectSmooth(result);
    expectWork(result, { script: 150 });
  });

  test("Viele fertige Tasks gleichzeitig erzeugen einen begrenzten Moment-Backlog", async () => {
    await run(
      `window.__ids = Array.from({ length: 40 }, (_, i) => __tasks.startTask({ title: "Job " + i }))`,
    );
    await page.waitForTimeout(700);
    const result = await sample(async () => {
      await run(`window.__ids.forEach((id) => __tasks.finishTask(id))`);
      await page.waitForTimeout(1500);
    });
    report("40 Tasks fertig", result);
    expect(await queueLength()).toBeLessThanOrEqual(QUEUE_LIMIT);
    expect(result.islandKeys.length).toBeLessThanOrEqual(2);
    expectSmooth(result);
  });

  test("Reduzierte Bewegung: keine Drop-Overlays und keine laufenden Island-Animationen", async () => {
    const calm = await browser.newPage({
      viewport: { width: 1440, height: 900 },
      reducedMotion: "reduce",
    });
    try {
      calm.on("pageerror", (error) => errors.push(error.message));
      await seedApp(calm, 50);
      await calm.goto(page.url(), { waitUntil: "domcontentloaded" });
      await calm.waitForSelector("[data-island]", { timeout: 120000 });
      await calm.waitForTimeout(1500);
      await calm.evaluate(async () => {
        const url = performance
          .getEntriesByType("resource")
          .map((entry) => entry.name)
          .find((name) => name.includes("/deps/sonner.js"));
        Object.assign(window, {
          __sonner: await import(url ?? ""),
          __island: await import("/src/lib/dynamic-island.ts"),
        });
      });
      await calm.evaluate(`(() => {
        __island.useIslandStore.setState({ queue: [] });
        __sonner.toast.success("Ruhig");
        __island.showIslandMoment({ key: "calm", glyph: { kind: "emoji", emoji: "🎉", effect: "pop" }, title: "Ruhig", duration: 3000 });
      })()`);
      await calm.waitForSelector('[data-island="calm"]');
      await calm.waitForSelector("[data-sonner-toast][data-dropped]");
      await calm.waitForTimeout(600);
      expect(await calm.locator("[data-toast-drop]").count()).toBe(0);
      expect(
        await calm.evaluate(
          () =>
            document
              .getAnimations()
              .filter(
                (animation) =>
                  animation.playState === "running" &&
                  ((animation.effect as KeyframeEffect | null)?.target as Element | null)?.closest(
                    "[data-island]",
                  ),
              ).length,
        ),
      ).toBe(0);
    } finally {
      await calm.close();
    }
  });

  test("Island deaktiviert: Toasts tropfen aus der Suche, Momente bleiben unsichtbar", async () => {
    await run(`__settings.useSettingsStore.setState({ dynamicIsland: false })`);
    await page.waitForFunction(() => !document.querySelector("[data-island]"));
    const result = await sample(async () => {
      await run(moment(`"hidden"`));
      await run(`__sonner.toast("Ohne Island")`);
      await page.waitForTimeout(1500);
    });
    report("Island aus", result);
    expect(result.islandKeys).toEqual([]);
    expect(result.drops).toBe(1);
    await run(`__settings.useSettingsStore.setState({ dynamicIsland: true })`);
    await page.waitForSelector("[data-island]");
  });

  test("Alles gleichzeitig bleibt unter CPU-Drosselung flüssig", async () => {
    const result = await sample(async () => {
      await run(`(() => {
        __island.previewIsland("Leon");
        for (let i = 0; i < 12; i++) __sonner.toast.info("Info " + i, { description: "Beschreibung" });
        __tasks.startTask({ title: "SQL-Abfrage" });
        const id = __tasks.startTask({ title: "Export", total: 1000 });
        let done = 0;
        window.__progress = setInterval(() => __tasks.updateTask(id, { progress: (done += 5) }), 50);
      })()`);
      await page.waitForTimeout(6000);
      await run(`clearInterval(window.__progress)`);
    });
    report("Alles gleichzeitig", result);
    expect(result.drops).toBeLessThanOrEqual(1);
    expectSmooth(result);
    expectWork(result, { script: 300 });
  });

  test("Hunderte Nachrichten hinterlassen weder Knoten noch Speicher noch Animationen", async () => {
    const heap = async () => {
      if (!cdp) return 0;
      await cdp.send("HeapProfiler.collectGarbage");
      return (await metrics()).JSHeapUsedSize ?? 0;
    };
    const nodes = () => page.evaluate(() => document.getElementsByTagName("*").length);
    const baseNodes = await nodes();
    const baseHeap = await heap();
    for (let round = 0; round < 10; round++) {
      await run(`(() => {
        for (let i = 0; i < 30; i++) __sonner.toast("Runde ${round} / " + i);
        for (let i = 0; i < 30; i++) __island.showIslandMoment({ key: "r${round}-" + i, glyph: { kind: "emoji", emoji: "🎉", effect: "pop" }, title: "Runde", duration: 300 });
      })()`);
      await page.waitForTimeout(300);
    }
    await settle();
    const idle = await sample(() => page.waitForTimeout(2000));
    report("Nach der Flut", idle);
    expect(await nodes()).toBeLessThanOrEqual(baseNodes + 40);
    expect((await heap()) - baseHeap).toBeLessThan(8 * 1024 * 1024);
    expect(await page.locator("[data-toast-drop]").count()).toBe(0);
    expect(await runningAnimations("body")).toBe(0);
    expect(idle.commits).toBeLessThanOrEqual(1);
    expectWork(idle, { styleCount: 2 });
  });

  test("Keine Seitenfehler", () => {
    expect(errors).toEqual([]);
  });
});
