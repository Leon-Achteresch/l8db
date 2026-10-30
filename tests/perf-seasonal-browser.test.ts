import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { chromium, type Page, webkit } from "playwright";
import { reportScenario } from "../scripts/performance-report";
import { seedApp } from "./fixtures/perf-app";
import { expectFrame, FRAME_BUDGETS } from "./fixtures/perf-webkit-profile";

const IN_SEASON = "2026-10-28T19:40:00";
const OFF_SEASON = "2026-09-30T19:40:00";
const GRID = { rows: 5000, columns: 120 };
const TABLE = "/tables/public/table_0000";
const READY = 'tbody tr[data-index="0"]';
const SPIDER = '[data-seasonal="spider"]';
const MIN_FPS = Number(process.env.L8DB_PERF_MIN_FPS ?? 55);
const MAX_P95_MS = Number(process.env.L8DB_PERF_MAX_P95 ?? 28);

type SpiderLog = {
  scheduled: number;
  cleared: number;
  fired: number;
  commands: string[];
};

async function open(path: string, now: string, settings: Record<string, unknown> = {}) {
  if (!(await Bun.file("dist/index.html").exists()))
    throw new Error("dist fehlt – vor dem Perf-Test 'bun run build' ausführen.");
  const server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      const pathname = new URL(request.url).pathname;
      const file = Bun.file(resolve("dist", pathname.replace(/^\//, "")));
      if (pathname !== "/" && (await file.exists())) return new Response(file);
      return new Response(Bun.file("dist/index.html"), {
        headers: { "Content-Type": "text/html" },
      });
    },
  });
  const engine = process.env.L8DB_PERF_ENGINE === "webkit" ? webkit : chromium;
  const browser = await engine.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await seedApp(page, 200, GRID);
  await page.addInitScript(
    ({ now, settings, rowLimit }) => {
      Object.defineProperty(Navigator.prototype, "webdriver", { get: () => false });
      const offset = new Date(now).getTime() - Date.now();
      const RealDate = Date;
      class ShiftedDate extends RealDate {
        constructor(...args: unknown[]) {
          if (args.length === 0) super(RealDate.now() + offset);
          else super(...(args as [number]));
        }
        static now() {
          return RealDate.now() + offset;
        }
      }
      Object.assign(window, { Date: ShiftedDate });
      const log = { scheduled: 0, cleared: 0, fired: 0, commands: [] as string[] };
      const spiderTimers = new Set<number>();
      const setTimer = window.setTimeout.bind(window);
      const clearTimer = window.clearTimeout.bind(window);
      Object.assign(window, {
        __spider: log,
        setTimeout: (callback: TimerHandler, delay?: number, ...rest: unknown[]) => {
          if (delay !== 2200 || typeof callback !== "function")
            return setTimer(callback, delay, ...rest);
          log.scheduled++;
          const id = setTimer(() => {
            spiderTimers.delete(id);
            log.fired++;
            callback(...rest);
          }, delay);
          spiderTimers.add(id);
          return id;
        },
        clearTimeout: (id?: number) => {
          if (id !== undefined && spiderTimers.delete(id)) log.cleared++;
          clearTimer(id);
        },
      });
      const internals = (
        window as unknown as {
          __TAURI_INTERNALS__: { invoke: (...args: unknown[]) => Promise<unknown> };
        }
      ).__TAURI_INTERNALS__;
      const invoke = internals.invoke;
      internals.invoke = (...args) => {
        log.commands.push(String(args[0]));
        return invoke(...args);
      };
      const saved = JSON.parse(localStorage.getItem("l8db.settings") ?? "{}");
      localStorage.setItem(
        "l8db.settings",
        JSON.stringify({
          ...saved,
          state: { ...saved.state, rowLimit, dynamicIsland: false, ...settings },
        }),
      );
    },
    { now, settings, rowLimit: GRID.rows },
  );
  await page.goto(`http://localhost:${server.port}${path}`);
  await page.waitForSelector(READY, { timeout: 60000 });
  return {
    page,
    errors,
    spider: () => page.evaluate(() => (window as unknown as { __spider: SpiderLog }).__spider),
    claim: () => page.evaluate(() => localStorage.getItem("l8db.seasonal.spider")),
    close: async () => {
      await browser.close();
      server.stop(true);
    },
  };
}

function sampleFrames(page: Page) {
  return page.evaluate(() => {
    const state = window as unknown as { __frames: number[]; __raf: number };
    state.__frames = [];
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      state.__frames.push(now - last);
      last = now;
      state.__raf = requestAnimationFrame(tick);
    };
    state.__raf = requestAnimationFrame(tick);
  });
}

function stopFrames(page: Page) {
  return page.evaluate(() => {
    const state = window as unknown as { __frames: number[]; __raf: number };
    cancelAnimationFrame(state.__raf);
    const frames = state.__frames.slice(1);
    const sorted = [...frames].sort((a, b) => a - b);
    return {
      fps: (frames.length / frames.reduce((sum, frame) => sum + frame, 0)) * 1000,
      p95: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
      worst: Math.max(...frames),
      frames: frames.length,
    };
  });
}

test.skipIf(!process.env.L8DB_PERF_APP)(
  "Spinne besucht 5.000 × 120 Zellen einmal am Tag flüssig, ohne Abfragen und mit begrenztem DOM",
  async () => {
    const app = await open(TABLE, IN_SEASON);
    try {
      await sampleFrames(app.page);
      await app.page.waitForSelector(`${SPIDER} p`, { timeout: 15000 });
      const atVisit = await app.spider();
      const nodes = await app.page.evaluate(
        (selector) => document.querySelector(selector)?.querySelectorAll("*").length ?? -1,
        SPIDER,
      );
      const quip = await app.page.locator(`${SPIDER} p`).innerText();
      await app.page.waitForSelector(SPIDER, { state: "detached", timeout: 15000 });
      const frames = await stopFrames(app.page);
      const afterVisit = await app.spider();
      console.log(
        `seasonal spider: ${nodes} Knoten, ${frames.fps.toFixed(1)} fps, p95 ${frames.p95.toFixed(1)} ms, worst ${frames.worst.toFixed(1)} ms, Spruch „${quip}“`,
      );
      expect(nodes).toBeGreaterThan(0);
      expect(nodes).toBeLessThan(40);
      expect(quip).toMatch(/120 Spalten|Keine einzige NULL|5\.000 Zeilen|Alles durchgesehen/);
      expectFrame(frames.fps).toBeGreaterThan(MIN_FPS);
      expectFrame(frames.p95).toBeLessThan(MAX_P95_MS);
      const databaseRequests = afterVisit.commands
        .slice(atVisit.commands.length)
        .filter((command) => /rows|query|list_|count|fetch/.test(command));
      expect(databaseRequests).toEqual([]);
      expect(afterVisit.fired).toBe(1);
      expect(await app.claim()).toBe("2026-10-28");
      expect(await app.page.locator('[data-seasonal="witch-hat"]').count()).toBeGreaterThan(0);

      await app.page.locator('a[data-name="table_0001"]').first().click();
      await app.page.waitForURL(/table_0001/);
      await app.page.waitForSelector(READY);
      await app.page.waitForTimeout(3000);
      expect(await app.page.locator(SPIDER).count()).toBe(0);
      expect((await app.spider()).scheduled).toBe(afterVisit.scheduled);
      expect(app.errors).toEqual([]);
      await reportScenario(`seasonal-spider-${process.env.L8DB_PERF_ENGINE ?? "chromium"}`, {
        rows: GRID.rows,
        columns: GRID.columns,
        spiderNodes: nodes,
        fps: frames.fps,
        p95Ms: frames.p95,
        worstMs: frames.worst,
        frameBudgets: FRAME_BUDGETS,
        databaseRequestsDuringVisit: databaseRequests.length,
        timersScheduled: afterVisit.scheduled,
      });
    } finally {
      await app.close();
    }
  },
  90000,
);

test.skipIf(!process.env.L8DB_PERF_APP)(
  "Geschlossener Tab bricht den ausstehenden Spinnenbesuch ab und schickt eine laufende Spinne weg",
  async () => {
    const app = await open(TABLE, IN_SEASON);
    try {
      await app.page.getByRole("button", { name: "table_0000 schließen" }).first().click();
      await app.page.waitForSelector(READY, { state: "detached" });
      await app.page.waitForTimeout(3000);
      const log = await app.spider();
      expect(log.scheduled).toBeGreaterThan(0);
      expect(log.cleared).toBe(log.scheduled);
      expect(log.fired).toBe(0);
      expect(await app.page.locator(SPIDER).count()).toBe(0);
      expect(await app.claim()).toBeNull();

      await app.page.locator('a[data-name="table_0001"]').first().click();
      await app.page.waitForSelector(`${SPIDER} p`, { timeout: 15000 });
      await app.page.getByRole("button", { name: "table_0001 schließen" }).first().click();
      await app.page.waitForSelector(SPIDER, { state: "detached", timeout: 2000 });
      expect(app.errors).toEqual([]);
    } finally {
      await app.close();
    }
  },
  90000,
);

test.skipIf(!process.env.L8DB_PERF_APP)(
  "Außerhalb der Saison und abgeschaltet plant die Spinne keine Timer",
  async () => {
    for (const [now, settings] of [
      [OFF_SEASON, {}],
      [IN_SEASON, { seasonalAccents: false }],
    ] as const) {
      const app = await open(TABLE, now, settings);
      try {
        await app.page.waitForTimeout(3000);
        expect((await app.spider()).scheduled).toBe(0);
        expect(await app.page.locator("[data-seasonal]").count()).toBe(0);
        expect(await app.claim()).toBeNull();
        expect(app.errors).toEqual([]);
      } finally {
        await app.close();
      }
    }
  },
  120000,
);
