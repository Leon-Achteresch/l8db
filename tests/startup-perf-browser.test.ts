import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { seedApp } from "./fixtures/perf-app";

const ENABLED = Boolean(process.env.L8DB_STARTUP_PERF);
const DIST = process.env.L8DB_PERF_DIST ?? "dist";
const RATE = Number(process.env.L8DB_PERF_CPU_RATE ?? 4);
const READY_BUDGET_MS = Number(process.env.L8DB_STARTUP_READY_MS ?? 2000);
const FRAME_BUDGET_MS = Number(process.env.L8DB_STARTUP_FRAME_MS ?? 50);

test.skipIf(!ENABLED)(
  "Start: erste nutzbare Ansicht und anschließende Framezeiten",
  async () => {
    if (!(await Bun.file(`${DIST}/index.html`).exists()))
      throw new Error(`${DIST} fehlt – vor dem Perf-Test 'bun run build' ausführen.`);
    const server = Bun.serve({
      port: 0,
      fetch: async (request) => {
        const pathname = new URL(request.url).pathname;
        const file = Bun.file(resolve(DIST, pathname.replace(/^\//, "")));
        if (pathname !== "/" && (await file.exists())) return new Response(file);
        return new Response(Bun.file(`${DIST}/index.html`), {
          headers: { "Content-Type": "text/html" },
        });
      },
    });
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route(
        (url) => url.hostname !== "localhost",
        (route) => route.fulfill({ contentType: "text/html", body: "" }),
      );
      await seedApp(page, 3000, { rows: 2000, columns: 60 }, "perf-test");
      await page.addInitScript(() => {
        const state = window as unknown as {
          __startupFrames: Array<{ at: number; duration: number }>;
          __startupTasks: Array<{ at: number; duration: number }>;
        };
        state.__startupFrames = [];
        state.__startupTasks = [];
        let last = 0;
        const tick = (now: number) => {
          if (last) state.__startupFrames.push({ at: now, duration: now - last });
          last = now;
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries())
            state.__startupTasks.push({ at: entry.startTime, duration: entry.duration });
        }).observe({ type: "longtask", buffered: true });
      });
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: RATE });
      await page.goto(`http://localhost:${server.port}/`);
      await page.waitForSelector('a[data-name="table_0000"]', { timeout: 60000 });
      const readyAt = await page.evaluate(() => performance.now());
      await page.waitForTimeout(4000);
      const measurements = await page.evaluate((readyAt) => {
        const state = window as unknown as {
          __startupFrames: Array<{ at: number; duration: number }>;
          __startupTasks: Array<{ at: number; duration: number }>;
        };
        const frames = state.__startupFrames.filter((frame) => frame.at >= readyAt);
        const tasks = state.__startupTasks.filter((task) => task.at >= readyAt);
        return {
          firstViewWorst: Math.max(
            0,
            ...state.__startupFrames
              .filter((frame) => frame.at < readyAt)
              .map((frame) => frame.duration),
          ),
          afterReadyWorst: Math.max(0, ...frames.map((frame) => frame.duration)),
          afterReadyTaskWorst: Math.max(0, ...tasks.map((task) => task.duration)),
        };
      }, readyAt);
      console.log(
        `startup-perf ${RATE}×: nutzbar nach ${readyAt.toFixed(0)} ms, bis dahin schlimmster Frame ${measurements.firstViewWorst.toFixed(0)} ms, danach ${measurements.afterReadyWorst.toFixed(0)} ms und längster Task ${measurements.afterReadyTaskWorst.toFixed(0)} ms`,
      );
      expect(readyAt).toBeLessThanOrEqual(READY_BUDGET_MS);
      expect(measurements.afterReadyWorst).toBeLessThanOrEqual(FRAME_BUDGET_MS);
      expect(measurements.afterReadyTaskWorst).toBeLessThanOrEqual(FRAME_BUDGET_MS);
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
      server.stop(true);
    }
  },
  60000,
);
