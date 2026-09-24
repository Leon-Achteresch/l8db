import { afterAll, beforeAll, expect, test } from "bun:test";
import { resolve } from "node:path";
import { type Browser, chromium, type Page } from "playwright";
import { seedApp } from "./fixtures/perf-app";

const ENABLED = Boolean(process.env.L8DB_PERF_THROTTLE);
const DIST = process.env.L8DB_PERF_DIST ?? "dist";
const RATE = Number(process.env.L8DB_PERF_CPU_RATE ?? 8);
const HEAP_LIMIT_MB = Number(process.env.L8DB_PERF_HEAP_LIMIT_MB ?? 512);
const HEAP_BUDGET_MB = Number(process.env.L8DB_PERF_HEAP_BUDGET_MB ?? 160);
const FRAME_P95_MS = Number(process.env.L8DB_PERF_FRAME_P95 ?? 17.5);
const FRAME_WORST_MS = Number(process.env.L8DB_PERF_FRAME_WORST ?? 50);
const STEP_WORST_MS = Number(process.env.L8DB_PERF_STEP_WORST ?? 100);

const VIEWS = [
  "/",
  "/tables/public/table_0000",
  "/query",
  "/er-diagram",
  "/monitor",
  "/sessions",
  "/sequences",
  "/enums",
  "/users/role_1",
  "/functions/public/fn_table_0000",
  "/replication",
  "/compare",
  "/schema-compare",
  "/versioning",
  "/invalid-objects",
  "/query-builder",
  "/import",
  "/create-table",
  "/alter-table/public/table_0000",
  "/view-editor/public/v_table_0000",
  "/matviews/public/mv_table_0000",
  "/saved-plan",
  "/dashboard",
  "/settings",
  "/connections",
  "/drivers",
  "/docs",
  "/about",
  "/mcp",
  "/release-notes",
  "/available-extensions",
  "/dev",
];

type Sample = { frames: number; p95: number; worst: number; dropped: number };

let browser: Browser;
let page: Page;
let server: ReturnType<typeof Bun.serve>;
const errors: string[] = [];

async function sample(run: () => Promise<void>): Promise<Sample> {
  await page.evaluate(() => {
    const state = window as unknown as { __frames: number[]; __last: number; __raf: number };
    state.__frames = [];
    state.__last = performance.now();
    const tick = (now: number) => {
      state.__frames.push(now - state.__last);
      state.__last = now;
      state.__raf = requestAnimationFrame(tick);
    };
    state.__raf = requestAnimationFrame(tick);
  });
  await run();
  return page.evaluate(() => {
    const state = window as unknown as { __frames: number[]; __last: number; __raf: number };
    cancelAnimationFrame(state.__raf);
    const frames = [...state.__frames.slice(1), performance.now() - state.__last];
    const sorted = [...frames].sort((a, b) => a - b);
    return {
      frames: frames.length,
      p95: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
      worst: Math.max(0, ...frames),
      dropped: frames.filter((frame) => frame > 20).length,
    };
  });
}

function report(name: string, result: Sample) {
  console.log(
    `perf-throttle ${name}: p95 ${result.p95.toFixed(1)} ms, worst ${result.worst.toFixed(0)} ms, ${result.dropped}/${result.frames} Frames > 20 ms`,
  );
}

function expectSmooth(name: string, result: Sample) {
  report(name, result);
  expect(result.p95).toBeLessThanOrEqual(FRAME_P95_MS);
  expect(result.worst).toBeLessThanOrEqual(FRAME_WORST_MS);
}

function expectStep(name: string, result: Sample) {
  report(name, result);
  expect(result.p95).toBeLessThanOrEqual(FRAME_P95_MS);
  expect(result.worst).toBeLessThanOrEqual(STEP_WORST_MS);
}

async function navigate(path: string) {
  await page.evaluate((target) => {
    history.pushState({}, "", target);
    dispatchEvent(new PopStateEvent("popstate"));
  }, path);
}

async function wheel(x: number, y: number, steps: number, distance: number) {
  await page.mouse.move(x, y);
  for (let step = 0; step < steps; step++) {
    await page.mouse.wheel(0, step % 10 < 5 ? distance : -distance);
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(300);
}

beforeAll(async () => {
  if (!ENABLED) return;
  if (!(await Bun.file(`${DIST}/index.html`).exists()))
    throw new Error(`${DIST} fehlt – vor dem Perf-Test 'bun run build' ausführen.`);
  server = Bun.serve({
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
  browser = await chromium.launch({
    headless: true,
    args: [`--js-flags=--max-old-space-size=${HEAP_LIMIT_MB}`, "--enable-precise-memory-info"],
  });
  page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on("pageerror", (error) => errors.push(error.message));
  await seedApp(page, 3000, { rows: 2000, columns: 60 });
  await page.goto(`http://localhost:${server.port}/`);
  await page.waitForSelector('a[data-name="table_0000"]', { timeout: 60000 });
  await page.waitForTimeout(2000);
  for (const view of VIEWS) {
    await navigate(view);
    await page.waitForTimeout(1500);
  }
  await navigate("/");
  await page.waitForTimeout(1500);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: RATE });
}, 300000);

afterAll(async () => {
  await browser?.close();
  server?.stop(true);
});

for (const view of VIEWS) {
  test.skipIf(!ENABLED)(
    `${view}: Wechsel, Leerlauf und Scrollen mit ${RATE}× CPU-Drosselung`,
    async () => {
      expectStep(
        `${view} wechseln`,
        await sample(async () => {
          await navigate(view);
          await page.waitForTimeout(2500);
        }),
      );
      expectSmooth(`${view} Leerlauf`, await sample(() => page.waitForTimeout(1500)));
      expectSmooth(`${view} scrollen`, await sample(() => wheel(900, 500, 20, 200)));
    },
    60000,
  );
}

test.skipIf(!ENABLED)(
  "Sidebar: Scrollen und Filtern über 3000 Tabellen",
  async () => {
    await navigate("/");
    await page.waitForTimeout(2500);
    expectSmooth("Sidebar scrollen", await sample(() => wheel(150, 500, 40, 200)));
    const search = page.getByPlaceholder("Tabellen…").first();
    await search.click();
    expectStep(
      "Sidebar filtern",
      await sample(async () => {
        await search.pressSequentially("table_01", { delay: 120 });
        await page.waitForTimeout(800);
        await search.fill("");
        await page.waitForTimeout(800);
      }),
    );
  },
  60000,
);

test.skipIf(!ENABLED)(
  "Tabelle: Öffnen, Scrollen in 2000 × 60 Zellen und Tabwechsel",
  async () => {
    expectStep(
      "Tabelle öffnen",
      await sample(async () => {
        await page.locator('a[data-name="table_0003"]').first().click();
        await page.waitForSelector('tbody tr[data-index="0"]');
        await page.waitForTimeout(2000);
      }),
    );
    expectSmooth(
      "Tabelle scrollen",
      await sample(() =>
        page.evaluate(async () => {
          let scroller = document.querySelector("tbody")?.parentElement ?? null;
          while (scroller && getComputedStyle(scroller).overflowY !== "auto")
            scroller = scroller.parentElement;
          if (!scroller) throw new Error("Kein Scroll-Container gefunden.");
          const target = scroller;
          let start = 0;
          await new Promise<void>((done) => {
            const step = (now: number) => {
              if (!start) start = now;
              target.scrollTop += 60;
              target.scrollLeft += now - start < 1500 ? 60 : -60;
              if (now - start < 3000) requestAnimationFrame(step);
              else done();
            };
            requestAnimationFrame(step);
          });
        }),
      ),
    );
    const tabs = page.locator("[data-tab-key]");
    expect(await tabs.count()).toBeGreaterThan(1);
    expectStep(
      "Tabs wechseln",
      await sample(async () => {
        for (const index of [0, 1, 0, 1]) {
          await tabs.nth(index).click();
          await page.waitForTimeout(700);
        }
      }),
    );
  },
  60000,
);

test.skipIf(!ENABLED)(
  "Befehlspalette öffnen und suchen",
  async () => {
    expectStep(
      "Befehlspalette",
      await sample(async () => {
        await page.keyboard.press("ControlOrMeta+k");
        await page.waitForTimeout(600);
        await page.keyboard.type("table_00", { delay: 120 });
        await page.waitForTimeout(800);
        await page.keyboard.press("Escape");
        await page.waitForTimeout(600);
      }),
    );
  },
  60000,
);

test.skipIf(!ENABLED)(
  "SQL-Editor: Tippen",
  async () => {
    await navigate("/query");
    await page.waitForSelector(".monaco-editor", { timeout: 30000 });
    await page.waitForTimeout(2000);
    await page.locator(".monaco-editor .view-lines").first().click();
    expectStep(
      "SQL tippen",
      await sample(async () => {
        await page.keyboard.type("select id, col_1 from table_0001 where col_2 = 1", {
          delay: 90,
        });
        await page.waitForTimeout(800);
      }),
    );
  },
  60000,
);

test.skipIf(!ENABLED)(
  "Dashboard: Scrollen, Ziehen und Hover",
  async () => {
    await navigate("/dashboard");
    await page.waitForSelector(".react-grid-item", { timeout: 30000 });
    await page.waitForTimeout(3000);
    expectSmooth("Dashboard scrollen", await sample(() => wheel(900, 500, 40, 200)));
    expectSmooth(
      "Dashboard Hover",
      await sample(async () => {
        for (let step = 0; step < 60; step++) {
          await page.mouse.move(300 + ((step * 23) % 1100), 250 + ((step * 37) % 500));
          await page.waitForTimeout(16);
        }
        await page.waitForTimeout(300);
      }),
    );
    const box = await page.locator(".react-grid-item").first().boundingBox();
    if (!box) throw new Error("Kein Widget im Dashboard gefunden.");
    expectSmooth(
      "Dashboard ziehen",
      await sample(async () => {
        await page.mouse.move(box.x + box.width / 2, box.y + 14);
        await page.mouse.down();
        for (let step = 0; step < 40; step++) {
          await page.mouse.move(
            box.x + box.width / 2 + Math.sin(step / 4) * 200,
            box.y + 14 + step * 4,
          );
          await page.waitForTimeout(16);
        }
        await page.mouse.up();
        await page.waitForTimeout(300);
      }),
    );
  },
  60000,
);

test.skipIf(!ENABLED)("Speicher und Fehler", async () => {
  const heapMb = await page.evaluate(
    () =>
      (performance as unknown as { memory: { usedJSHeapSize: number } }).memory.usedJSHeapSize /
      1024 /
      1024,
  );
  console.log(`perf-throttle JS-Heap: ${heapMb.toFixed(0)} MB`);
  expect(heapMb).toBeLessThanOrEqual(HEAP_BUDGET_MB);
  expect(errors).toEqual([]);
});
