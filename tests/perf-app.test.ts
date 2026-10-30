import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { chromium, type Page, webkit } from "playwright";
import { reportScenario } from "../scripts/performance-report";
import { seedApp } from "./fixtures/perf-app";
import { expectFrame, FRAME_BUDGETS } from "./fixtures/perf-webkit-profile";

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
  await reportScenario(`${name}-${process.env.L8DB_PERF_ENGINE ?? "chromium"}`, {
    ...sample,
    frameBudgets: FRAME_BUDGETS,
  });
  return sample;
}

async function wheel(page: Page, x: number, y: number, steps: number, distance: number) {
  await page.mouse.move(x, y);
  for (let step = 0; step < steps; step++) {
    await page.mouse.wheel(0, step % 10 < 5 ? distance : -distance);
    await page.waitForTimeout(16);
  }
}

async function open(
  path: string,
  ready: string,
  grid?: { rows: number; columns: number },
  overviewSchemas = 8,
  {
    rowLimit = grid?.rows,
    setup,
  }: { rowLimit?: number; setup?: (page: Page) => Promise<void> } = {},
) {
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
  await seedApp(page, TABLES, grid, null, overviewSchemas);
  if (rowLimit)
    await page.addInitScript((rowLimit) => {
      const saved = JSON.parse(localStorage.getItem("l8db.settings") ?? "{}");
      localStorage.setItem(
        "l8db.settings",
        JSON.stringify({ ...saved, state: { ...saved.state, rowLimit } }),
      );
    }, rowLimit);
  await setup?.(page);
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
  "Übersicht mit 1000 Schemas bleibt begrenzt und erlaubt die Auswahl des letzten Schemas",
  async () => {
    const app = await open("/", 'a[data-name="table_0000"]', undefined, 1000);
    try {
      const schemas = app.page.locator('section[aria-label="Schemas"]');
      await schemas.locator("button").first().waitFor();
      expect(await schemas.locator("button").count()).toBeLessThan(30);
      await schemas.locator("button").first().focus();
      await app.page.keyboard.press("End");
      await app.page.waitForFunction(() =>
        document.activeElement?.textContent?.includes("schema_999"),
      );
      await schemas.getByRole("button", { name: /schema_999/ }).click();
      await app.page.waitForFunction(() =>
        document
          .querySelector('section[aria-label="Schemas"] button[aria-current="true"]')
          ?.textContent?.includes("schema_999"),
      );
      expect(app.errors).toEqual([]);
    } finally {
      await app.close();
    }
  },
  60000,
);

test.skipIf(!process.env.L8DB_PERF_APP)(
  `Übersicht und Sidebar bleiben bei ${TABLES} Tabellen flüssig`,
  async () => {
    const app = await open("/", 'a[data-name="table_0000"]');
    try {
      const dom = await app.page.evaluate(() => ({
        sidebarItems: document.querySelectorAll("[data-slot=sidebar-menu-item]").length,
        overviewRows:
          document.querySelector('[data-slot="dashboard-table-list"] > div')?.childElementCount ??
          -1,
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
      await app.page
        .locator('button[data-tour="sidebar-connection"] span[aria-hidden] svg')
        .waitFor();

      const sidebarScroll = await measure("sidebar-scroll", app.page, () =>
        wheel(app.page, 150, 500, 40, 200),
      );
      expectFrame(sidebarScroll.fps).toBeGreaterThan(MIN_FPS);
      expectFrame(sidebarScroll.p95).toBeLessThan(MAX_P95_MS);

      const overviewScroll = await measure("overview-scroll", app.page, async () => {
        await app.page.locator('[data-slot="dashboard-table-list"]').first().hover();
        for (let step = 0; step < 40; step++) {
          await app.page.mouse.wheel(0, step % 10 < 5 ? 200 : -200);
          await app.page.waitForTimeout(16);
        }
      });
      expectFrame(overviewScroll.fps).toBeGreaterThan(MIN_FPS);
      expectFrame(overviewScroll.p95).toBeLessThan(MAX_P95_MS);

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
      expectFrame(tabSwitch.fps).toBeGreaterThan(MIN_FPS);
      expectFrame(tabSwitch.p95).toBeLessThan(MAX_P95_MS);
      expectFrame(tabSwitch.worst).toBeLessThan(200);
      await app.page.getByRole("tab", { name: /Views/i }).first().click();
      await app.page
        .getByRole("tab", { name: /Tabellen/i })
        .first()
        .click();
      await app.page.waitForFunction(
        () =>
          document
            .querySelector('[role="tab"][aria-label="Tabellen"]')
            ?.getAttribute("aria-selected") === "true",
      );
      await app.page.locator('a[data-name="table_0000"]').waitFor();

      expect(app.errors).toEqual([]);
    } finally {
      await app.close();
    }
  },
  180000,
);

test.skipIf(!process.env.L8DB_PERF_APP)(
  "Sidebar-Spaltensuche bleibt virtualisiert",
  async () => {
    const app = await open("/", 'a[data-name="table_0000"]');
    try {
      const longTasks = await app.page.evaluateHandle(() => {
        const durations: number[] = [];
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) durations.push(entry.duration);
        }).observe({ type: "longtask" });
        return durations;
      });
      await app.page.locator('[data-tour="sidebar-search"] input').first().click();
      await app.page.keyboard.type("col_1", { delay: 30 });
      await app.page.locator('[data-slot="sidebar-menu-sub-button"]').first().waitFor();
      await app.page.waitForTimeout(500);
      const dom = await app.page.evaluate(() => ({
        items: document.querySelectorAll("[data-slot=sidebar-menu-item]").length,
        nodes: document.querySelectorAll("*").length,
      }));
      const worst = await longTasks.evaluate((durations) => Math.max(0, ...durations));
      console.log(
        `perf sidebar-column-search: ${dom.items} Einträge, ${dom.nodes} Knoten, längster Task ${worst.toFixed(0)} ms`,
      );
      expect(dom.items).toBeLessThan(60);
      expect(worst).toBeLessThan(200);

      await app.page.locator("[data-slot=sidebar-content]").evaluate(async (scroller) => {
        for (let step = 0; step < 6; step++) {
          scroller.scrollTop = scroller.scrollHeight;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      });
      await app.page.locator('a[data-name="table_0499"]').waitFor();
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
    const app = await open("/dashboard", ".l8-item");
    try {
      await app.page.waitForTimeout(2000);
      const scroll = await measure("dashboard-scroll", app.page, () =>
        wheel(app.page, 900, 500, 50, 200),
      );
      expectFrame(scroll.fps).toBeGreaterThan(MIN_FPS);
      expectFrame(scroll.p95).toBeLessThan(MAX_P95_DASHBOARD_MS);

      const box = await app.page.locator(".l8-item [data-l8-handle]").first().boundingBox();
      if (!box) throw new Error("Kein Widget im Dashboard gefunden.");
      const drag = await measure("dashboard-drag", app.page, async () => {
        await app.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await app.page.mouse.down();
        for (let step = 0; step < 40; step++) {
          await app.page.mouse.move(
            box.x + box.width / 2 + Math.sin(step / 4) * 200,
            box.y + box.height / 2 + step * 4,
          );
          await app.page.waitForTimeout(16);
        }
        await app.page.mouse.up();
      });
      expectFrame(drag.fps).toBeGreaterThan(MIN_FPS);
      expectFrame(drag.p95).toBeLessThan(MAX_P95_DASHBOARD_MS);

      expect(app.errors).toEqual([]);
    } finally {
      await app.close();
    }
  },
  180000,
);

test.skipIf(!process.env.L8DB_PERF_APP)(
  "Dashboard lädt Monaco erst für eine eigene SQL-Abfrage",
  async () => {
    const app = await open("/dashboard", ".l8-item");
    try {
      expect(await app.page.locator(".monaco-editor").count()).toBe(0);
      expect(
        await app.page.evaluate(() =>
          performance
            .getEntriesByType("resource")
            .some((entry) => entry.name.includes("editor.api")),
        ),
      ).toBe(false);
      const edit = app.page.getByRole("button", { name: "Dashboard bearbeiten", exact: true });
      if (await edit.count()) await edit.click();
      await app.page.getByRole("button", { name: "Chart erstellen", exact: true }).click();
      await app.page.getByRole("textbox", { name: "Chart-Titel", exact: true }).waitFor();
      expect(await app.page.locator(".monaco-editor").count()).toBe(0);
      await app.page.getByRole("tab", { name: "Eigenes SQL", exact: true }).click();
      expect(await app.page.locator(".monaco-editor").count()).toBe(0);
      await app.page.getByRole("button", { name: "Ich möchte selbst SQL schreiben" }).click();
      await app.page.locator('.monaco-editor[role="code"]').waitFor();
      expect(app.errors).toEqual([]);
    } finally {
      await app.close();
    }
  },
  60000,
);

test.skipIf(!process.env.L8DB_PERF_APP)(
  "Monitor lädt das Latenzdiagramm nur mit Laufzeitdaten",
  async () => {
    const app = await open("/monitor", '[data-tour="monitor"]');
    try {
      await app.page.getByRole("button", { name: "Weitere Monitor-Aktionen" }).click();
      await app.page.getByRole("menuitem", { name: "Query-Verlauf" }).click();
      await app.page.getByText("Noch keine Laufzeitdaten vorhanden.").waitFor();
      expect(await app.page.getByText("Noch keine Laufzeitdaten vorhanden.").count()).toBe(1);
      expect(
        await app.page.evaluate(() =>
          performance
            .getEntriesByType("resource")
            .some((entry) => entry.name.includes("monitor-latency-chart")),
        ),
      ).toBe(false);
      await app.page.evaluate(() => {
        localStorage.setItem(
          "l8db.query-history",
          JSON.stringify({
            state: {
              retentionLimit: 500,
              entries: [
                {
                  id: "perf-monitor-latency",
                  connectionId: "perf",
                  database: "l8db_perf",
                  sql: "SELECT 1",
                  ranAt: Date.now(),
                  durationMs: 15,
                  rowCount: 1,
                  error: null,
                },
              ],
            },
            version: 0,
          }),
        );
      });
      await app.page.reload();
      await app.page.getByRole("button", { name: "Weitere Monitor-Aktionen" }).click();
      await app.page.getByRole("menuitem", { name: "Query-Verlauf" }).click();
      await app.page.locator('[data-slot="chart"]').waitFor();
      expect(
        await app.page.evaluate(() =>
          performance
            .getEntriesByType("resource")
            .some((entry) => entry.name.includes("monitor-latency-chart")),
        ),
      ).toBe(true);
      expect(app.errors).toEqual([]);
    } finally {
      await app.close();
    }
  },
  60000,
);

test.skipIf(!process.env.L8DB_PERF_APP)(
  "Live-Monitor bleibt bei 1000 Sessions begrenzt und fragt nur im Intervall ab",
  async () => {
    const app = await open("/", 'a[data-name="table_0000"]');
    try {
      await app.page.evaluate(() => localStorage.setItem("l8db.perf.sessions", "1000"));
      const started = Date.now();
      await app.page.goto(app.page.url().replace(/\/$/, "/monitor"));
      await app.page.getByText("Aktive Sessions (1000)").waitFor({ timeout: 30000 });
      const ready = Date.now() - started;
      await app.page.locator('[data-slot="chart"]').waitFor({ timeout: 20000 });
      const before = await app.page.evaluate(
        () => (window as unknown as { __liveMetricsCalls?: number }).__liveMetricsCalls ?? 0,
      );
      await app.page.waitForTimeout(10500);
      const after = await app.page.evaluate(
        () => (window as unknown as { __liveMetricsCalls?: number }).__liveMetricsCalls ?? 0,
      );
      const dom = await app.page.evaluate(() => ({
        rows: document.querySelectorAll('[role="tabpanel"][data-state="active"] tbody tr').length,
        nodes: document.querySelectorAll("*").length,
      }));
      const durations: number[] = [];
      for (let index = 0; index < 9; index++) {
        const clickStarted = performance.now();
        await app.page
          .locator("tbody tr")
          .nth(index + 1)
          .click();
        await app.page
          .getByText(`PID ${8001 + index}`, { exact: true })
          .first()
          .waitFor();
        durations.push(performance.now() - clickStarted);
      }
      durations.sort((a, b) => a - b);
      await app.page.getByRole("button", { name: "Aktualisierung pausieren" }).click();
      const paused = await app.page.evaluate(
        () => (window as unknown as { __liveMetricsCalls?: number }).__liveMetricsCalls ?? 0,
      );
      await app.page.waitForTimeout(6000);
      const idle = await app.page.evaluate(
        () => (window as unknown as { __liveMetricsCalls?: number }).__liveMetricsCalls ?? 0,
      );
      const limits = {
        readyMs: 15000,
        rows: 200,
        nodes: 9000,
        requestsPer10s: 3,
        selectMedianMs: 250,
        selectP95Ms: 600,
        requestsWhilePaused: 0,
      };
      console.log(
        `performance live-monitor-browser: ${JSON.stringify({
          sessions: 1000,
          readyMs: ready,
          rows: dom.rows,
          nodes: dom.nodes,
          requestsPer10s: after - before,
          selectMedianMs: durations[4],
          selectP95Ms: durations[8],
          requestsWhilePaused: idle - paused,
          limits,
        })}`,
      );
      expect(ready).toBeLessThan(limits.readyMs);
      expect(dom.rows).toBeLessThanOrEqual(limits.rows);
      expect(dom.nodes).toBeLessThan(limits.nodes);
      expect(after - before).toBeLessThanOrEqual(limits.requestsPer10s);
      expect(after - before).toBeGreaterThanOrEqual(1);
      expect(durations[4]).toBeLessThan(limits.selectMedianMs);
      expect(durations[8]).toBeLessThan(limits.selectP95Ms);
      expect(idle - paused).toBe(limits.requestsWhilePaused);
      expect(app.errors).toEqual([]);
    } finally {
      await app.close();
    }
  },
  90000,
);

test.skipIf(!process.env.L8DB_PERF_APP)(
  `Erweiterte Suche bleibt bei ${TABLES} Tabellen begrenzt und bedienbar`,
  async () => {
    const app = await open("/", 'a[data-name="table_0000"]');
    try {
      await app.page.getByRole("button", { name: "Erweiterte Suche" }).click();
      const results = app.page.getByRole("region", { name: "Suchergebnisse" });
      await results.waitFor();
      await app.page.waitForTimeout(250);
      expect(await results.locator("[data-index]").count()).toBeGreaterThan(0);
      expect(await results.locator("[data-index]").count()).toBeLessThan(80);
      expect(await app.page.getByText(`${TABLES + Math.min(TABLES, 400)} Ergebnisse`).count()).toBe(
        1,
      );
      const lastView = `v_table_${String(Math.min(TABLES, 400) - 1).padStart(4, "0")}`;
      await results.locator("button").first().focus();
      await app.page.keyboard.press("End");
      await app.page.waitForFunction((name) => {
        const active = document.activeElement;
        return Boolean(
          active?.tagName === "BUTTON" &&
            active.closest('[aria-label="Suchergebnisse"]') &&
            active.textContent?.includes(name),
        );
      }, lastView);
      await app.page.keyboard.press("Home");
      await app.page.waitForFunction(() => {
        const active = document.activeElement;
        return Boolean(
          active?.tagName === "BUTTON" &&
            active.closest('[aria-label="Suchergebnisse"]') &&
            active.textContent?.includes("table_0000"),
        );
      });
      const scroll = await measure("advanced-search-scroll", app.page, async () => {
        await results.evaluate(async (element) => {
          let start = 0;
          await new Promise<void>((resolve) => {
            const step = (now: number) => {
              if (!start) start = now;
              element.scrollTop += now - start < 2500 ? 120 : -120;
              if (now - start < 5000) requestAnimationFrame(step);
              else resolve();
            };
            requestAnimationFrame(step);
          });
        });
      });
      expectFrame(scroll.fps).toBeGreaterThan(59);
      expectFrame(scroll.p95).toBeLessThan(21);
      expect(await results.locator("[data-index]").count()).toBeLessThan(80);

      await results.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      await app.page.waitForFunction(
        (lastView) =>
          document.querySelector('[aria-label="Suchergebnisse"]')?.textContent?.includes(lastView),
        lastView,
      );
      const lastTable = `table_${String(TABLES - 1).padStart(4, "0")}`;
      await app.page.locator('input[placeholder*="mehrere mit"]').fill(`public.${lastTable}`);
      await app.page.waitForFunction(
        (name) =>
          document.querySelector('[aria-label="Suchergebnisse"]')?.textContent?.includes(name),
        lastTable,
      );
      expect(await results.locator("[data-index]").count()).toBe(1);
      await app.page.locator('input[placeholder*="mehrere mit"]').fill("col_1");
      await app.page.getByText(`${Math.min(TABLES, 500)} Ergebnisse`).waitFor();
      expect(await results.locator("[data-index]").count()).toBeLessThan(80);
      await results.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      await app.page.waitForFunction(
        (lastColumnTable) =>
          document
            .querySelector('[aria-label="Suchergebnisse"]')
            ?.textContent?.includes(lastColumnTable),
        `table_${String(Math.min(TABLES, 500) - 1).padStart(4, "0")}`,
      );
      expect(await app.page.locator(".monaco-editor").count()).toBe(0);
      await app.page.locator('input[placeholder*="mehrere mit"]').fill("table_0000");
      await results.locator('[data-index="0"] button').click();
      await app.page.route(/\/assets\/sql-editor-[^/]+\.js$/, async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 800));
        await route.continue();
      });
      await app.page.getByRole("tab", { name: "SQL", exact: true }).click();
      await app.page.getByRole("textbox", { name: "SQL-Filter" }).fill("status = 'active'");
      const sqlEditor = app.page.locator(".cm-editor");
      await sqlEditor.waitFor();
      expect(
        await app.page.evaluate(() =>
          performance
            .getEntriesByType("resource")
            .some((entry) => entry.name.includes("editor.api")),
        ),
      ).toBe(false);
      await app.page.waitForFunction(() =>
        document
          .querySelector(".cm-editor .cm-content")
          ?.textContent?.replace(/\u00a0/g, " ")
          .includes("status = 'active'"),
      );
      expect(await sqlEditor.evaluate((element) => element.contains(document.activeElement))).toBe(
        true,
      );
      expect(app.errors).toEqual([]);
    } finally {
      await app.close();
    }
  },
  60000,
);

test.skipIf(!process.env.L8DB_PERF_APP)(
  "View Editor lädt Monaco erst für die Definition",
  async () => {
    const app = await open(
      "/view-editor/public/v_table_0000",
      '[data-slot="tabs-content"][data-state="active"]',
    );
    try {
      await app.page.getByRole("tab", { name: "Daten" }).waitFor();
      expect(await app.page.locator(".monaco-editor").count()).toBe(0);
      expect(
        await app.page.evaluate(() =>
          performance
            .getEntriesByType("resource")
            .some((entry) => entry.name.includes("editor.api")),
        ),
      ).toBe(false);
      await app.page.getByRole("tab", { name: "Definition" }).click();
      await app.page.locator('.monaco-editor[role="code"]').waitFor();
      expect(app.errors).toEqual([]);
    } finally {
      await app.close();
    }
  },
  60000,
);

test.skipIf(!process.env.L8DB_PERF_APP)(
  "Tabellenscrollen im vollständigen Workspace mit 5000 Zeilen und 120 Spalten",
  async () => {
    const app = await open("/tables/public/table_0000", 'tbody tr[data-index="0"]', {
      rows: 5000,
      columns: 120,
    });
    try {
      const sample = await measure("workspace-table-scroll", app.page, async () => {
        await app.page.evaluate(async () => {
          let scroller = document.querySelector("tbody")?.parentElement ?? null;
          while (scroller && getComputedStyle(scroller).overflowY !== "auto")
            scroller = scroller.parentElement;
          if (!scroller) throw new Error("Kein Scroll-Container gefunden.");
          const target = scroller;
          let start = 0;
          await new Promise<void>((resolve) => {
            const step = (now: number) => {
              if (!start) start = now;
              target.scrollTop += 120;
              target.scrollLeft += now - start < 5000 ? 120 : -120;
              if (now - start < 10000) requestAnimationFrame(step);
              else resolve();
            };
            requestAnimationFrame(step);
          });
        });
      });
      expectFrame(sample.fps).toBeGreaterThan(59);
      expectFrame(sample.p95).toBeLessThan(21);
      expectFrame(sample.worst).toBeLessThan(50);
      expect(await app.page.locator("tbody tr[data-index]").count()).toBeLessThan(100);
      expect(app.errors).toEqual([]);
    } finally {
      await app.close();
    }
  },
  60000,
);

test.skipIf(!process.env.L8DB_PERF_APP)(
  "Breites SQL-Ergebnis bleibt beim Scrollen vollständig und flüssig",
  async () => {
    const app = await open("/query", ".monaco-editor", { rows: 5000, columns: 120 });
    try {
      await app.page.locator(".monaco-editor .view-lines").first().click();
      await app.page.keyboard.type("select 'perf wide'");
      await app.page
        .getByRole("button", { name: "Statement ausführen", exact: true })
        .first()
        .click();
      await app.page.waitForSelector('tbody tr[data-index="0"]');
      const scroll = await measure("wide-query-result-scroll", app.page, () =>
        app.page.evaluate(async () => {
          let scroller = document.querySelector("tbody")?.parentElement ?? null;
          while (scroller && getComputedStyle(scroller).overflowY !== "auto")
            scroller = scroller.parentElement;
          if (!scroller) throw new Error("Kein Scroll-Container gefunden.");
          const target = scroller;
          let start = 0;
          await new Promise<void>((resolve) => {
            const step = (now: number) => {
              if (!start) start = now;
              target.scrollTop += now - start < 2500 ? 90 : -90;
              target.scrollLeft += now - start < 2500 ? 90 : -90;
              if (now - start < 5000) requestAnimationFrame(step);
              else resolve();
            };
            requestAnimationFrame(step);
          });
        }),
      );
      expectFrame(scroll.fps).toBeGreaterThan(55);
      expectFrame(scroll.p95).toBeLessThan(28);
      expect(await app.page.locator("tbody tr[data-index]").count()).toBeLessThan(100);
      expect(app.errors).toEqual([]);
    } finally {
      await app.close();
    }
  },
  60000,
);

type RowStats = { offsets: number[]; inflight: number; maxInflight: number; cancels: number };

async function trackRowRequests(page: Page) {
  await page.addInitScript(() => {
    const internals = (
      window as unknown as {
        __TAURI_INTERNALS__: {
          invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
        };
      }
    ).__TAURI_INTERNALS__;
    const original = internals.invoke;
    const stats = { offsets: [] as number[], inflight: 0, maxInflight: 0, cancels: 0 };
    Object.assign(window, { __rowStats: stats });
    internals.invoke = async (command, args) => {
      if (command === "cancel_execution") stats.cancels++;
      if (command !== "fetch_table_rows") return original(command, args);
      stats.offsets.push(Number(args?.offset ?? 0));
      stats.inflight++;
      stats.maxInflight = Math.max(stats.maxInflight, stats.inflight);
      try {
        await new Promise((resolve) => setTimeout(resolve, 40));
        return await original(command, args);
      } finally {
        stats.inflight--;
      }
    };
  });
}

const rowStats = (page: Page) =>
  page.evaluate(() => structuredClone((window as unknown as { __rowStats: RowStats }).__rowStats));

function centerRow(page: Page) {
  return page.evaluate(() => {
    const scroller = document.querySelector<HTMLElement>("[data-grid-scroll]");
    if (!scroller) return null;
    const box = scroller.getBoundingClientRect();
    const row = document
      .elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
      ?.closest("tr[data-index]");
    const id = row?.querySelector('td[data-col="id"]')?.textContent;
    const number = row?.querySelector("td")?.textContent;
    return id ? { id: Number(id), number: Number(number) } : null;
  });
}

async function heapBytes(page: Page) {
  if (process.env.L8DB_PERF_ENGINE === "webkit") return null;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("HeapProfiler.collectGarbage");
  const { usedSize } = await cdp.send("Runtime.getHeapUsage");
  await cdp.detach();
  return usedSize;
}

function percentile(values: number[], fraction: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
}

test.skipIf(!process.env.L8DB_PERF_APP)(
  "Infinite Scrolling durch 2.000.000 Zeilen bleibt flüssig, speicherbegrenzt und sparsam bei Anfragen",
  async () => {
    const app = await open(
      "/tables/public/table_0000",
      'tbody tr[data-index="0"]',
      { rows: 2_000_000, columns: 30 },
      8,
      { rowLimit: 100, setup: trackRowRequests },
    );
    try {
      const heapBefore = await heapBytes(app.page);
      const scroll = await measure("infinite-table-scroll", app.page, () =>
        app.page.evaluate(async () => {
          const target = document.querySelector<HTMLElement>("[data-grid-scroll]")!;
          let start = 0;
          await new Promise<void>((resolve) => {
            const step = (now: number) => {
              if (!start) start = now;
              target.scrollTop += 90;
              if (now - start < 8000) requestAnimationFrame(step);
              else resolve();
            };
            requestAnimationFrame(step);
          });
        }),
      );
      await app.page.waitForTimeout(400);
      const reached = await centerRow(app.page);
      const afterScroll = await rowStats(app.page);
      const domRows = await app.page.locator("tbody tr[data-index]").count();
      const heapAfter = await heapBytes(app.page);
      const pages = Math.floor((reached?.id ?? 0) / 100) + 1;

      const exposure = await app.page.evaluate(async () => {
        const target = document.querySelector<HTMLElement>("[data-grid-scroll]")!;
        const box = target.getBoundingClientRect();
        let samples = 0;
        let placeholders = 0;
        let frame = 0;
        let start = 0;
        await new Promise<void>((resolve) => {
          const step = (now: number) => {
            if (!start) start = now;
            target.scrollTop += 60;
            if (++frame % 6 === 0) {
              samples++;
              const hit = document.elementFromPoint(
                box.left + box.width / 2,
                box.top + box.height / 2,
              );
              if (!hit?.closest("tr[data-index]")) placeholders++;
            }
            if (now - start < 3000) requestAnimationFrame(step);
            else resolve();
          };
          requestAnimationFrame(step);
        });
        return { samples, placeholders };
      });

      const maxTop = await app.page.evaluate(
        () => document.querySelector<HTMLElement>("[data-grid-scroll]")!.scrollTop,
      );
      const jumpLatencies: number[] = [];
      const jumpErrors: string[] = [];
      for (let jump = 1; jump <= 7; jump++) {
        const top = Math.round((maxTop * ((jump * 37) % 100)) / 100);
        const started = Date.now();
        await app.page.evaluate((top) => {
          document.querySelector<HTMLElement>("[data-grid-scroll]")!.scrollTop = top;
        }, top);
        let row = await centerRow(app.page);
        while (!row && Date.now() - started < 5000) {
          await app.page.waitForTimeout(10);
          row = await centerRow(app.page);
        }
        jumpLatencies.push(Date.now() - started);
        if (!row || row.number !== row.id + 1) jumpErrors.push(`${top}: ${JSON.stringify(row)}`);
      }

      const beforeDrag = await rowStats(app.page);
      await app.page.evaluate(async (maxTop) => {
        const target = document.querySelector<HTMLElement>("[data-grid-scroll]")!;
        for (let frame = 0; frame < 25; frame++) {
          target.scrollTop = (maxTop * ((frame * 53) % 100)) / 100;
          await new Promise(requestAnimationFrame);
        }
        target.scrollTop = maxTop / 3;
      }, maxTop);
      await app.page.waitForTimeout(800);
      const afterDrag = await rowStats(app.page);
      await app.page.waitForTimeout(2000);
      const idle = await rowStats(app.page);

      const summary = {
        scroll,
        reachedRow: reached?.id,
        pages,
        fetches: afterScroll.offsets.length,
        uniqueFetches: new Set(afterScroll.offsets).size,
        maxInflight: idle.maxInflight,
        cancels: idle.cancels,
        domRows,
        heapGrowthMb: heapBefore && heapAfter ? (heapAfter - heapBefore) / 1024 / 1024 : null,
        exposure,
        jumpMedianMs: percentile(jumpLatencies, 0.5),
        jumpP95Ms: percentile(jumpLatencies, 0.95),
        dragFetches: afterDrag.offsets.length - beforeDrag.offsets.length,
        idleFetches: idle.offsets.length - afterDrag.offsets.length,
      };
      console.log(`perf infinite-table ${JSON.stringify(summary)}`);
      expect(reached?.id ?? 0).toBeGreaterThan(500);
      expectFrame(scroll.fps).toBeGreaterThan(MIN_FPS);
      expectFrame(scroll.p95).toBeLessThan(MAX_P95_MS);
      expect(summary.uniqueFetches).toBe(summary.fetches);
      expect(summary.fetches).toBeLessThanOrEqual(pages + 3);
      expect(summary.maxInflight).toBeLessThanOrEqual(2);
      expect(domRows).toBeLessThan(100);
      if (summary.heapGrowthMb !== null) expect(summary.heapGrowthMb).toBeLessThan(40);
      expect(exposure.placeholders / exposure.samples).toBeLessThan(0.1);
      expect(jumpErrors).toEqual([]);
      expect(summary.jumpP95Ms).toBeLessThan(800);
      expect(summary.dragFetches).toBeLessThanOrEqual(3);
      expect(summary.idleFetches).toBe(0);
      expect(app.errors).toEqual([]);
    } finally {
      await app.close();
    }
  },
  120000,
);

test.skipIf(!process.env.L8DB_PERF_APP)(
  "Letzte Seite springt in 100.000 Zeilen ohne Zwischenseiten ans Ende",
  async () => {
    const app = await open(
      "/tables/public/table_0000",
      'tbody tr[data-index="0"]',
      { rows: 100_000, columns: 30 },
      8,
      { rowLimit: 100, setup: trackRowRequests },
    );
    try {
      await app.page.getByText("Seite 1 / 1000", { exact: true }).waitFor();
      const before = await rowStats(app.page);
      const started = Date.now();
      await app.page.getByRole("button", { name: "Letzte Seite", exact: true }).click();
      await app.page.getByText("Seite 1000 / 1000", { exact: true }).waitFor();
      await app.page.waitForFunction(() =>
        [...document.querySelectorAll('td[data-col="id"]')].some(
          (cell) => cell.textContent === "99900",
        ),
      );
      const latency = Date.now() - started;
      const after = await rowStats(app.page);
      const fetched = after.offsets.slice(before.offsets.length);
      await app.page.getByRole("button", { name: "Erste Seite", exact: true }).click();
      await app.page.waitForFunction(
        () =>
          document.querySelector('tbody tr[data-index="0"] td[data-col="id"]')?.textContent === "0",
      );
      console.log(`perf infinite-last-page ${JSON.stringify({ latency, fetched })}`);
      expect(fetched.every((offset) => offset >= 99_000)).toBe(true);
      expect(fetched.length).toBeLessThanOrEqual(2);
      expect(latency).toBeLessThan(1000);
      expect(app.errors).toEqual([]);
    } finally {
      await app.close();
    }
  },
  60000,
);
