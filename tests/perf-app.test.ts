import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { chromium, type Page, webkit } from "playwright";
import { seedApp } from "./fixtures/perf-app";

const TABLES = Number(process.env.L8DB_PERF_TABLES ?? 3000);
const MIN_FPS = Number(process.env.L8DB_PERF_MIN_FPS ?? 55);
const MAX_P95_MS = Number(process.env.L8DB_PERF_MAX_P95 ?? 28);
const MAX_P95_DASHBOARD_MS = Number(process.env.L8DB_PERF_MAX_P95_DASHBOARD ?? 40);

type Sample = { fps: number; worst: number; p95: number; frames: number };

function startSampling(page: Page) {
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

function stopSampling(page: Page): Promise<Sample> {
  return page.evaluate(() => {
    const state = window as unknown as { __frames: number[]; __raf: number };
    cancelAnimationFrame(state.__raf);
    const frames = state.__frames.slice(1);
    const total = frames.reduce((sum, frame) => sum + frame, 0);
    const sorted = [...frames].sort((a, b) => a - b);
    return {
      fps: (frames.length / total) * 1000,
      worst: Math.max(...frames),
      p95: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
      frames: frames.length,
    };
  });
}

async function measure(name: string, page: Page, run: () => Promise<void>): Promise<Sample> {
  await startSampling(page);
  await run();
  const sample = await stopSampling(page);
  console.log(
    `perf ${name}: ${sample.fps.toFixed(1)} fps, p95 ${sample.p95.toFixed(1)} ms, worst ${sample.worst.toFixed(1)} ms, ${sample.frames} Frames`,
  );
  return sample;
}

async function wheel(page: Page, x: number, y: number, steps: number, distance: number) {
  await page.mouse.move(x, y);
  for (let step = 0; step < steps; step++) {
    await page.mouse.wheel(0, step % 10 < 5 ? distance : -distance);
    await page.waitForTimeout(16);
  }
}

async function open(path: string, ready: string) {
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
  const browser = await (process.env.L8DB_PERF_ENGINE === "webkit" ? webkit : chromium).launch({
    headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await seedApp(page, TABLES);
  await page.goto(`http://localhost:${server.port}${path}`);
  await page.waitForSelector(ready, { timeout: 60000 });
  await page.waitForTimeout(2500);
  return {
    page,
    errors,
    close: async () => {
      await browser.close();
      server.stop(true);
    },
  };
}

test.skipIf(!process.env.L8DB_PERF_APP)(
  `Übersicht und Sidebar bleiben bei ${TABLES} Tabellen flüssig`,
  async () => {
    const app = await open("/", 'a[data-name="table_0000"]');
    try {
      const dom = await app.page.evaluate(() => ({
        sidebarItems: document.querySelectorAll("[data-slot=sidebar-menu-item]").length,
        overviewRows: document.querySelector(".max-h-80.overflow-auto")?.childElementCount ?? -1,
        nodes: document.querySelectorAll("*").length,
      }));
      console.log(
        `perf dom: ${dom.sidebarItems} Sidebar-Einträge, ${dom.overviewRows} Übersichtszeilen, ${dom.nodes} Knoten`,
      );
      expect(dom.sidebarItems).toBeGreaterThan(0);
      expect(dom.sidebarItems).toBeLessThan(120);
      expect(dom.overviewRows).toBeGreaterThan(0);
      expect(dom.overviewRows).toBeLessThan(60);
      expect(dom.nodes).toBeLessThan(6000);

      const sidebarScroll = await measure("sidebar-scroll", app.page, () =>
        wheel(app.page, 150, 500, 40, 200),
      );
      expect(sidebarScroll.fps).toBeGreaterThan(MIN_FPS);
      expect(sidebarScroll.p95).toBeLessThan(MAX_P95_MS);

      const overviewScroll = await measure("overview-scroll", app.page, async () => {
        await app.page.locator(".max-h-80.overflow-auto").first().hover();
        for (let step = 0; step < 40; step++) {
          await app.page.mouse.wheel(0, step % 10 < 5 ? 200 : -200);
          await app.page.waitForTimeout(16);
        }
      });
      expect(overviewScroll.fps).toBeGreaterThan(MIN_FPS);
      expect(overviewScroll.p95).toBeLessThan(MAX_P95_MS);

      const tabSwitch = await measure("sidebar-tab-switch", app.page, async () => {
        for (let round = 0; round < 3; round++) {
          await app.page.getByRole("tab", { name: /Views/i }).first().click();
          await app.page.waitForTimeout(400);
          await app.page
            .getByRole("tab", { name: /Tabellen/i })
            .first()
            .click();
          await app.page.waitForTimeout(400);
        }
      });
      expect(tabSwitch.fps).toBeGreaterThan(MIN_FPS);
      expect(tabSwitch.p95).toBeLessThan(MAX_P95_MS);
      expect(tabSwitch.worst).toBeLessThan(200);

      expect(app.errors).toEqual([]);
    } finally {
      await app.close();
    }
  },
  180000,
);

test.skipIf(!process.env.L8DB_PERF_APP)(
  "Dashboard bleibt beim Scrollen flüssig",
  async () => {
    const app = await open("/dashboard", ".react-grid-item");
    try {
      await app.page.waitForTimeout(2000);
      const scroll = await measure("dashboard-scroll", app.page, () =>
        wheel(app.page, 900, 500, 50, 200),
      );
      expect(scroll.fps).toBeGreaterThan(MIN_FPS);
      expect(scroll.p95).toBeLessThan(MAX_P95_DASHBOARD_MS);

      const box = await app.page.locator(".react-grid-item").first().boundingBox();
      if (!box) throw new Error("Kein Widget im Dashboard gefunden.");
      const drag = await measure("dashboard-drag", app.page, async () => {
        await app.page.mouse.move(box.x + box.width / 2, box.y + 14);
        await app.page.mouse.down();
        for (let step = 0; step < 40; step++) {
          await app.page.mouse.move(
            box.x + box.width / 2 + Math.sin(step / 4) * 200,
            box.y + 14 + step * 4,
          );
          await app.page.waitForTimeout(16);
        }
        await app.page.mouse.up();
      });
      expect(drag.fps).toBeGreaterThan(MIN_FPS);
      expect(drag.p95).toBeLessThan(MAX_P95_DASHBOARD_MS);

      expect(app.errors).toEqual([]);
    } finally {
      await app.close();
    }
  },
  180000,
);
