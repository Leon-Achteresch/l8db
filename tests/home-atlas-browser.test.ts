import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { chromium, webkit } from "playwright";
import { cpuThrottleRate, reportScenario } from "../scripts/performance-report";
import { seedApp } from "./fixtures/perf-app";

test.skipIf(!process.env.L8DB_HOME_ATLAS_BROWSER)(
  "Startseiten-Atlas begrenzt die Kacheln, bleibt beim Überfahren flüssig und findet die letzte Tabelle",
  async () => {
    const webkitEngine = process.env.L8DB_HOME_ATLAS_ENGINE === "webkit";
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
      const map = page.locator('fieldset[aria-label^="Tabellenkarte"]');
      await map.locator("[data-atlas-index]").first().waitFor();
      const tiles = await map.locator("[data-atlas-index]").count();
      expect(tiles).toBeGreaterThan(20);
      expect(tiles).toBeLessThanOrEqual(24);
      if (!webkitEngine) {
        const cdp = await page.context().newCDPSession(page);
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: await cpuThrottleRate(4) });
      }
      const box = await map.boundingBox();
      if (!box) throw new Error("Tabellenkarte fehlt");
      await page.evaluate(() => {
        const state = window as unknown as {
          __atlasFrames: number[];
          __atlasLast: number;
          __atlasRaf: number;
        };
        state.__atlasFrames = [];
        state.__atlasLast = performance.now();
        const tick = (now: number) => {
          state.__atlasFrames.push(now - state.__atlasLast);
          state.__atlasLast = now;
          state.__atlasRaf = requestAnimationFrame(tick);
        };
        state.__atlasRaf = requestAnimationFrame(tick);
      });
      for (let step = 0; step < 60; step++)
        await page.mouse.move(
          box.x + (((step * 97) % 100) / 100) * box.width,
          box.y + (((step * 61) % 100) / 100) * box.height,
          { steps: 3 },
        );
      await page.waitForTimeout(400);
      const frames = await page.evaluate(() => {
        const state = window as unknown as { __atlasFrames: number[]; __atlasRaf: number };
        cancelAnimationFrame(state.__atlasRaf);
        return state.__atlasFrames.slice(1).sort((a, b) => a - b);
      });
      const p95 = frames[Math.floor(frames.length * 0.95)] ?? 0;
      const median = frames[Math.floor(frames.length / 2)] ?? 0;
      await reportScenario("home-atlas-hover", {
        engine: webkitEngine ? "webkit" : "chromium",
        cpuRate: webkitEngine ? 1 : 4,
        tables: 3000,
        tiles,
        medianFrameMs: median,
        p95FrameMs: p95,
      });
      if (!webkitEngine) expect(p95).toBeLessThanOrEqual(34);
      const search = page.getByRole("searchbox", { name: /Tabellen in public finden/ });
      await search.fill("table_2999");
      await map.getByRole("button", { name: /^table_2999/ }).waitFor();
      expect(await map.locator("[data-atlas-index]").count()).toBe(1);
      await search.press("Enter");
      await page.waitForURL(/\/tables\/public\/table_2999/);
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
      server.stop(true);
    }
  },
  60000,
);
