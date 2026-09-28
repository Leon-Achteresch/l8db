import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { chromium, webkit } from "playwright";
import { seedApp } from "./fixtures/perf-app";

test.skipIf(!process.env.L8DB_DASHBOARD_TABLE_BROWSER)(
  "Dashboard-Tabellenliste hält beim Start wenige Zeilen im DOM und erreicht das Listenende",
  async () => {
    const webkitEngine = process.env.L8DB_DASHBOARD_TABLE_ENGINE === "webkit";
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
    const browser = await (webkitEngine ? webkit : chromium).launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route(
        (url) => url.hostname !== "localhost",
        (route) => route.fulfill({ contentType: "text/html", body: "" }),
      );
      await seedApp(page, 3000, { rows: 2, columns: 2 }, "perf-test");
      await page.goto(`http://localhost:${server.port}/`);
      const list = page.locator('[data-slot="dashboard-table-list"]');
      await list.getByRole("link", { name: /table_0000/ }).waitFor();
      expect(await list.getByRole("link").count()).toBeLessThanOrEqual(20);
      if (!webkitEngine) {
        const cdp = await page.context().newCDPSession(page);
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
      }
      await list.hover();
      await page.evaluate(() => {
        const state = window as unknown as {
          __dashboardFrames: number[];
          __dashboardLast: number;
          __dashboardRaf: number;
        };
        state.__dashboardFrames = [];
        state.__dashboardLast = performance.now();
        const tick = (now: number) => {
          state.__dashboardFrames.push(now - state.__dashboardLast);
          state.__dashboardLast = now;
          state.__dashboardRaf = requestAnimationFrame(tick);
        };
        state.__dashboardRaf = requestAnimationFrame(tick);
      });
      for (let step = 0; step < 10; step++) {
        await page.mouse.wheel(0, 200);
        await page.waitForTimeout(20);
      }
      await page.waitForTimeout(500);
      const frames = await page.evaluate(() => {
        const state = window as unknown as {
          __dashboardFrames: number[];
          __dashboardRaf: number;
        };
        cancelAnimationFrame(state.__dashboardRaf);
        return state.__dashboardFrames.slice(1).sort((a, b) => a - b);
      });
      const p95 = frames[Math.floor(frames.length * 0.95)] ?? 0;
      console.log(
        `dashboard-table-scroll ${webkitEngine ? "WebKit" : "Chromium 4×"}: p95 ${p95.toFixed(1)} ms`,
      );
      if (!webkitEngine) expect(p95).toBeLessThanOrEqual(17.5);
      await list.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      await list.getByRole("link", { name: /table_0049/ }).waitFor();
      await page
        .getByRole("textbox", { name: "Tabellen in der Übersicht suchen" })
        .fill("table_2999");
      await list.getByRole("link", { name: /table_2999/ }).waitFor();
      expect(await list.getByRole("link").count()).toBe(1);
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
      server.stop(true);
    }
  },
  60000,
);
