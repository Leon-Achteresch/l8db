import { afterAll, beforeAll, expect, test } from "bun:test";
import { resolve } from "node:path";
import { type Browser, chromium, type Page, webkit } from "playwright";
import { seedApp } from "./fixtures/perf-app";

const ENABLED = Boolean(process.env.L8DB_PERF_THROTTLE);
const WEBKIT = process.env.L8DB_PERF_ENGINE === "webkit";
const DIST = process.env.L8DB_PERF_DIST ?? "dist";
const RATE = WEBKIT ? 1 : Number(process.env.L8DB_PERF_CPU_RATE ?? 8);
const HEAP_LIMIT_MB = Number(process.env.L8DB_PERF_HEAP_LIMIT_MB ?? 512);
const HEAP_BUDGET_MB = Number(process.env.L8DB_PERF_HEAP_BUDGET_MB ?? 160);
const GRID_ROWS = Number(process.env.L8DB_PERF_GRID_ROWS ?? 2000);
const GRID_COLUMNS = Number(process.env.L8DB_PERF_GRID_COLUMNS ?? 60);
const FRAME_P95_MS = Number(process.env.L8DB_PERF_FRAME_P95 ?? 17.5);
const FRAME_WORST_MS = Number(process.env.L8DB_PERF_FRAME_WORST ?? 50);
const STEP_WORST_MS = Number(process.env.L8DB_PERF_STEP_WORST ?? 100);
const CLICK_WORST_MS = Number(process.env.L8DB_PERF_CLICK_WORST ?? Math.max(48, RATE * 12));

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
const WARMUP_VIEWS = process.env.L8DB_PERF_WARMUP_VIEWS?.split(",") ?? VIEWS;

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
  browser = await (WEBKIT ? webkit : chromium).launch({
    headless: true,
    args: WEBKIT
      ? []
      : [`--js-flags=--max-old-space-size=${HEAP_LIMIT_MB}`, "--enable-precise-memory-info"],
  });
  page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route(
    (url) => url.hostname !== "localhost",
    (route) => route.fulfill({ contentType: "text/html", body: "" }),
  );
  await seedApp(page, 3000, { rows: GRID_ROWS, columns: GRID_COLUMNS }, "perf-test");
  await page.goto(`http://localhost:${server.port}/`);
  await page.waitForSelector('a[data-name="table_0000"]', { timeout: 60000 });
  await page.waitForTimeout(2000);
  for (const view of WARMUP_VIEWS) {
    await navigate(view);
    await page.waitForTimeout(1500);
  }
  await navigate("/");
  await page.waitForTimeout(1500);
  if (!WEBKIT) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: RATE });
  }
}, 300000);

afterAll(async () => {
  await browser?.close();
  server?.stop(true);
});

for (const view of VIEWS) {
  test.skipIf(!ENABLED)(
    `${view}: Wechsel, Leerlauf und Scrollen mit ${RATE}× CPU-Drosselung`,
    async () => {
      const step = await sample(async () => {
        await navigate(view);
        await page.waitForTimeout(2500);
      });
      expect(await page.getByText("ROUTE_ERROR").count()).toBe(0);
      expectStep(`${view} wechseln`, step);
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
    const sidebarScroller = page.locator("[data-slot=sidebar-content]").first();
    await sidebarScroller.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await page.locator('a[data-name="table_2999"]').waitFor();
    await sidebarScroller.evaluate((element) => {
      element.scrollTop = 0;
    });
    await page.locator('a[data-name="table_0000"]').first().waitFor();
    await page.waitForTimeout(300);
    const search = page.locator("[data-tour=sidebar-search] input").first();
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
  "Erweiterte Suche blockiert den ersten Klick nicht",
  async () => {
    await navigate("/");
    await page.locator('a[data-name="table_0000"]').first().waitFor();
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      const clicks: number[] = [];
      Object.assign(window, { __searchClickDurations: clicks });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.name === "click") clicks.push(entry.duration);
        }
      }).observe({ type: "event", durationThreshold: 16 });
    });
    await page.getByRole("button", { name: "Erweiterte Suche" }).click();
    await page.getByRole("region", { name: "Suchergebnisse" }).waitFor();
    await page.waitForTimeout(100);
    const durations = await page.evaluate(
      () => (window as unknown as { __searchClickDurations: number[] }).__searchClickDurations,
    );
    expect(durations.length).toBeGreaterThan(0);
    const worst = Math.max(...durations);
    console.log(`perf-throttle Erweiterte Suche Klick: ${worst} ms`);
    expect(worst).toBeLessThanOrEqual(CLICK_WORST_MS);
    await page.keyboard.press("Escape");
  },
  60000,
);

test.skipIf(!ENABLED)(
  `Tabelle: Öffnen, Scrollen in ${GRID_ROWS} × ${GRID_COLUMNS} Zellen und Tabwechsel`,
  async () => {
    expectStep(
      "Tabelle öffnen",
      await sample(async () => {
        await page.locator('a[data-name="table_0003"]').first().click();
        await page.waitForSelector('tbody tr[data-index="0"]');
        await page.waitForTimeout(2000);
      }),
    );
    const scrollTable = (checkCoverage: boolean) =>
      page.evaluate(async (checkCoverage) => {
        let scroller = document.querySelector("tbody")?.parentElement ?? null;
        while (scroller && getComputedStyle(scroller).overflowY !== "auto")
          scroller = scroller.parentElement;
        if (!scroller) throw new Error("Kein Scroll-Container gefunden.");
        const target = scroller;
        const coverage = { samples: 0, gaps: 0, misses: [] as unknown[] };
        let start = 0;
        await new Promise<void>((done) => {
          const step = (now: number) => {
            if (!start) start = now;
            if (checkCoverage) {
              const box = target.getBoundingClientRect();
              for (const x of [box.left + box.width * 0.4, box.left + box.width * 0.8]) {
                for (const y of [box.top + box.height * 0.4, box.top + box.height * 0.8]) {
                  const cell = document.elementFromPoint(x, y)?.closest("td");
                  coverage.samples++;
                  if (!cell?.closest("tr[data-index]") || cell.hasAttribute("aria-hidden")) {
                    coverage.gaps++;
                    if (coverage.misses.length < 12)
                      coverage.misses.push({
                        top: target.scrollTop,
                        left: target.scrollLeft,
                        x,
                        y,
                        cell: cell?.outerHTML.slice(0, 110),
                      });
                  }
                }
              }
            }
            target.scrollTop += now - start < 1500 ? 60 : -60;
            target.scrollLeft += now - start < 1500 ? 60 : -60;
            if (now - start < 3000) requestAnimationFrame(step);
            else done();
          };
          requestAnimationFrame(step);
        });
        return coverage;
      }, checkCoverage);
    const tableScroll = await sample(async () => {
      await scrollTable(false);
    });
    expectSmooth("Tabelle scrollen", tableScroll);
    const coverage = await scrollTable(true);
    if (coverage.gaps) console.log("grid coverage", coverage);
    expect(coverage.samples).toBeGreaterThan(100);
    expect(coverage.gaps).toBe(0);
    const tabs = page.locator("[data-tab-key]");
    await page.locator('a[data-name="table_0004"]').first().click();
    await page.waitForSelector('tbody tr[data-index="0"]');
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

test.skipIf(!ENABLED)(
  "Dashboard: erster Chart-Klick bleibt reaktionsschnell",
  async () => {
    await navigate("/dashboard");
    await page.waitForSelector(".react-grid-item", { timeout: 30000 });
    const edit = page.getByRole("button", { name: "Dashboard bearbeiten", exact: true });
    if (await edit.count()) await edit.click();
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      const clicks: number[] = [];
      Object.assign(window, { __chartClickDurations: clicks });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.name === "click") clicks.push(entry.duration);
        }
      }).observe({ type: "event", durationThreshold: 16 });
    });
    await page.getByRole("button", { name: "Chart erstellen", exact: true }).click();
    await page.getByRole("dialog", { name: "Dein neuer Chart" }).waitFor();
    await page.waitForTimeout(100);
    const durations = await page.evaluate(
      () => (window as unknown as { __chartClickDurations: number[] }).__chartClickDurations,
    );
    expect(durations.length).toBeGreaterThan(0);
    const worst = Math.max(...durations);
    console.log(`perf-throttle Dashboard Chart Klick: ${worst} ms`);
    expect(worst).toBeLessThanOrEqual(CLICK_WORST_MS);
    await page.keyboard.press("Escape");
  },
  60000,
);

test.skipIf(!ENABLED)(
  "SQL-Werkzeugmenü: erster Klick und erneutes Öffnen",
  async () => {
    await navigate("/query");
    await page.locator(".monaco-editor .view-lines").first().click();
    await page.waitForTimeout(1000);
    await page.evaluate(() => {
      const clicks: number[] = [];
      Object.assign(window, { __editorClickDurations: clicks });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.name === "click") clicks.push(entry.duration);
        }
      }).observe({ type: "event", durationThreshold: 16 });
    });
    await page.keyboard.type("select 1", { delay: 5 });
    const result = await sample(async () => {
      await page.getByRole("button", { name: "Weitere Werkzeuge" }).click();
      await page.waitForTimeout(500);
    });
    report("SQL-Werkzeugmenü öffnen", result);
    expect(await page.getByRole("menuitem", { name: "Bibliothek" }).isVisible()).toBe(true);
    await page.keyboard.press("Escape");
    await page.getByRole("menuitem", { name: "Bibliothek" }).waitFor({ state: "hidden" });
    expect(
      await page
        .getByRole("button", { name: "Weitere Werkzeuge" })
        .evaluate((element) => element === document.activeElement),
    ).toBe(true);
    await page.waitForTimeout(300);
    const second = await sample(async () => {
      await page.getByRole("button", { name: "Weitere Werkzeuge" }).click();
      await page.waitForTimeout(500);
    });
    report("SQL-Werkzeugmenü erneut öffnen", second);
    const durations = await page.evaluate(
      () => (window as unknown as { __editorClickDurations: number[] }).__editorClickDurations,
    );
    console.log(`perf-throttle SQL-Werkzeugmenü Klicks: ${durations.join(", ")} ms`);
    expect(Math.max(0, ...durations)).toBeLessThanOrEqual(Math.max(96, RATE * 18));
    await page.getByRole("menuitem", { name: "Bibliothek" }).hover();
    await page.getByRole("menuitem", { name: "Snippets verwalten…" }).click();
    await page.getByRole("dialog", { name: "SQL-Snippets" }).waitFor();
    await page.keyboard.press("Escape");
    await page.getByRole("menuitem", { name: "Bibliothek" }).waitFor({ state: "hidden" });
  },
  30000,
);

test.skipIf(!ENABLED)(
  "SQL- und Tabellenmenüs reagieren beim ersten Klick",
  async () => {
    await navigate("/query");
    await page.locator(".monaco-editor .view-lines").first().click();
    await page.keyboard.type("select 1", { delay: 5 });
    await page.waitForTimeout(800);
    await page.evaluate(() => {
      const clicks: number[] = [];
      Object.assign(window, { __moreMenuClicks: clicks });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.name === "click") clicks.push(entry.duration);
        }
      }).observe({ type: "event", durationThreshold: 16 });
    });
    const measureClick = async (name: string, action: () => Promise<void>) => {
      await page.evaluate(() => {
        (window as unknown as { __moreMenuClicks: number[] }).__moreMenuClicks.length = 0;
      });
      const frames = await sample(async () => {
        await action();
        await page.waitForTimeout(500);
      });
      report(name, frames);
      const clicks = await page.evaluate(
        () => (window as unknown as { __moreMenuClicks: number[] }).__moreMenuClicks,
      );
      console.log(`perf-throttle ${name} Klick: ${clicks.join(", ")} ms`);
      return Math.max(0, ...clicks);
    };

    const runClick = await measureClick("SQL-Ausführungsarten", () =>
      page.getByRole("button", { name: "Weitere Ausführungsarten" }).click(),
    );
    expect(runClick).toBeLessThanOrEqual(Math.max(72, RATE * 18));
    await page.getByRole("menuitem", { name: /Statement unter Cursor/ }).waitFor();
    await page.keyboard.press("Escape");
    await page
      .getByRole("menuitem", { name: /Statement unter Cursor/ })
      .waitFor({ state: "hidden" });

    const settingsClick = await measureClick("SQL-Anpassen", () =>
      page.getByRole("button", { name: "Anpassen" }).click(),
    );
    expect(settingsClick).toBeLessThanOrEqual(Math.max(104, RATE * 26));
    const settingsDialog = page.getByRole("dialog", { name: "Query Editor anpassen" });
    await settingsDialog.getByRole("switch", { name: "Schema-Navigator" }).waitFor();
    await page.keyboard.press("Escape");
    await settingsDialog.waitFor({ state: "hidden" });

    await navigate("/tables/public/table_0000");
    await page.waitForSelector('tbody tr[data-index="0"]');
    await page.waitForTimeout(700);
    const exportClick = await measureClick("Tabellen-Export", () =>
      page.locator('[data-tour="table-toolbar"]').getByRole("button", { name: "Export" }).click(),
    );
    expect(exportClick).toBeLessThanOrEqual(Math.max(72, RATE * 18));
    await page.getByRole("menuitem", { name: "Als CSV exportieren…" }).waitFor();
    await page.keyboard.press("Escape");
    await page.getByRole("menuitem", { name: "Als CSV exportieren…" }).waitFor({ state: "hidden" });
  },
  30000,
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

test.skipIf(!ENABLED)(
  "Proxy-Benutzer-Menü öffnet beim ersten Klick und übernimmt eine Rolle",
  async () => {
    await navigate("/");
    errors.length = 0;
    const trigger = page.getByRole("button", { name: "Als Benutzer ansehen" });
    await trigger.waitFor();
    await trigger.evaluate((element) => {
      const state = window as unknown as { __proxyClickAt: number; __proxyReadyAt: number };
      element.addEventListener("click", () => (state.__proxyClickAt = performance.now()), {
        once: true,
      });
      const observer = new MutationObserver(() => {
        if (!document.querySelector('[aria-label="Proxy-Benutzer suchen"]')) return;
        state.__proxyReadyAt = performance.now();
        observer.disconnect();
      });
      observer.observe(document.body, { childList: true, subtree: true });
    });
    const frames = await sample(async () => {
      await trigger.click();
      await page.getByRole("combobox", { name: "Proxy-Benutzer suchen" }).waitFor();
      await page.waitForTimeout(1200);
    });
    if (WEBKIT) {
      report("Proxy-Benutzer-Menü erster Klick", frames);
      expect(frames.worst).toBeLessThanOrEqual(STEP_WORST_MS);
    } else expectStep("Proxy-Benutzer-Menü erster Klick", frames);
    const readyMs = await page.evaluate(() => {
      const state = window as unknown as { __proxyClickAt: number; __proxyReadyAt: number };
      return state.__proxyReadyAt - state.__proxyClickAt;
    });
    console.log(`perf-throttle Proxy-Benutzer-Menü Eingabe sichtbar: ${readyMs.toFixed(0)} ms`);
    expect(readyMs).toBeLessThanOrEqual(Math.max(80, RATE * 20));
    const search = page.getByRole("combobox", { name: "Proxy-Benutzer suchen" });
    expect(await search.evaluate((input) => document.activeElement === input)).toBe(true);
    expect(await page.getByRole("option").count()).toBeLessThanOrEqual(100);
    expect(await page.getByText("… und 2902 weitere. Suche eingrenzen.").count()).toBe(1);
    await page.getByRole("option", { name: "reader" }).click();
    const activeTrigger = page.getByRole("button", { name: "Ansicht als reader" });
    await activeTrigger.waitFor();
    await activeTrigger.click();
    await search.fill("w");
    await search.press("ArrowDown");
    await search.press("ArrowUp");
    await search.press("Enter");
    const writerTrigger = page.getByRole("button", { name: "Ansicht als writer" });
    await writerTrigger.waitFor();
    await writerTrigger.click();
    await search.fill("analyst");
    await search.press("Enter");
    const analystTrigger = page.getByRole("button", { name: "Ansicht als analyst" });
    await analystTrigger.waitFor();
    await analystTrigger.click();
    await page.getByRole("option", { name: "Als analyst beenden" }).click();
    await trigger.waitFor();
    expect(errors).toEqual([]);
  },
  30000,
);

test.skipIf(!ENABLED)(
  "Breite SQL-Ergebnisse: Suchen, JSON und Scrollen",
  async () => {
    await navigate("/query");
    await page.locator(".monaco-editor .view-lines").first().click();
    await page.keyboard.type("select perf wide", { delay: 5 });
    await page
      .getByRole("button", { name: /Ausführen/ })
      .first()
      .click();
    const search = page.getByRole("textbox", { name: "Ergebnisse durchsuchen" });
    await search.waitFor();
    await page.waitForTimeout(1000);
    const searchFrames = await sample(async () => {
      await search.pressSequentially("nomatch", { delay: 120 });
      await page.waitForTimeout(900);
    });
    if (WEBKIT) report("Breite SQL-Ergebnisse suchen", searchFrames);
    else expectSmooth("Breite SQL-Ergebnisse suchen", searchFrames);
    await search.fill("");
    await page.waitForTimeout(300);
    const jsonFrames = await sample(async () => {
      await page.getByRole("button", { name: "JSON", exact: true }).click();
      await page.waitForTimeout(900);
    });
    report("Breite SQL-Ergebnisse JSON", jsonFrames);
    if (!WEBKIT) {
      expect(jsonFrames.p95).toBeLessThanOrEqual(FRAME_P95_MS);
      expect(jsonFrames.worst).toBeLessThanOrEqual(Math.max(67, RATE * 9));
    }
    const json = page.locator('[data-slot="query-json-rows"]');
    expect(await json.locator("[data-index]").count()).toBeLessThan(20);
    expect((await json.textContent())?.startsWith("[\n")).toBe(true);
    await search.fill("nomatch");
    await page.waitForFunction(
      () => document.querySelectorAll('[data-slot="query-json-rows"] [data-index]').length === 2,
    );
    expect(await json.textContent()).not.toContain('"id":');
    await search.fill("");
    await json.locator('[data-index="1"]').waitFor();
    await page.waitForFunction(
      (minimumHeight) => {
        const element = document.querySelector<HTMLElement>('[data-slot="query-json-rows"]');
        return element && element.scrollHeight > minimumHeight;
      },
      GRID_ROWS * GRID_COLUMNS * 10,
    );
    await json.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await json.locator(`[data-index="${GRID_ROWS}"]`).waitFor();
    expect(await json.textContent()).toContain(`"id": ${GRID_ROWS - 1}`);
    expect((await json.textContent())?.endsWith("]")).toBe(true);
    await json.evaluate((element) => {
      element.scrollTop = 0;
    });
    let coverage = { samples: 0, gaps: 0 };
    const scrollFrames = await sample(async () => {
      coverage = await page.evaluate(async () => {
        const element = document.querySelector<HTMLElement>('[data-slot="query-json-rows"]');
        if (!element) throw new Error("JSON-Ansicht fehlt.");
        const max = element.scrollHeight - element.clientHeight;
        const coverage = { samples: 0, gaps: 0 };
        let start = 0;
        await new Promise<void>((done) => {
          const step = (now: number) => {
            if (!start) start = now;
            const rect = element.getBoundingClientRect();
            const node = document.elementFromPoint(rect.left + 40, rect.top + rect.height / 2);
            coverage.samples++;
            if (!node?.closest("[data-index]")) coverage.gaps++;
            element.scrollTop = Math.min(1, (now - start) / 3000) * max;
            if (now - start < 3000) requestAnimationFrame(step);
            else done();
          };
          requestAnimationFrame(step);
        });
        return coverage;
      });
    });
    if (WEBKIT) report("Breite SQL-Ergebnisse JSON scrollen", scrollFrames);
    else expectSmooth("Breite SQL-Ergebnisse JSON scrollen", scrollFrames);
    expect(coverage.samples).toBeGreaterThan(100);
    expect(coverage.gaps).toBe(0);
  },
  30000,
);
