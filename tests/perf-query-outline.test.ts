import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { chromium, webkit } from "playwright";
import { reportScenario } from "../scripts/performance-report";
import { seedApp } from "./fixtures/perf-app";
import { interactionPercentiles, measureAppClick } from "./fixtures/perf-app-interactions";
import {
  appRequestSnapshot,
  installAppRequestProbe,
  requestCounts,
  requestsSince,
} from "./fixtures/perf-app-requests";

test.skipIf(!process.env.L8DB_PERF_APP)(
  "SQL-Statement-Navigator bleibt bei langen Skripten bedienbar",
  async () => {
    const dist = process.env.L8DB_PERF_DIST ?? "dist";
    const server = Bun.serve({
      port: 0,
      fetch: async (request) => {
        const pathname = new URL(request.url).pathname;
        const file = Bun.file(resolve(dist, pathname.replace(/^\//, "")));
        return new Response(
          pathname !== "/" && (await file.exists()) ? file : Bun.file(resolve(dist, "index.html")),
        );
      },
    });
    const throttled = process.env.L8DB_PERF_ENGINE !== "webkit";
    const browser = await (throttled ? chromium : webkit).launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await seedApp(page, 100);
      await installAppRequestProbe(page);
      await page.addInitScript(() => {
        const sql = Array.from({ length: 3000 }, (_, index) => `SELECT ${index} AS value;`).join(
          "\n",
        );
        localStorage.setItem(
          "l8db.table-tabs",
          JSON.stringify({
            version: 4,
            state: {
              tabsByConnection: {
                perf: [{ kind: "query", id: "outline-perf", title: "Outline Perf", sql }],
              },
            },
          }),
        );
        localStorage.setItem(
          "l8db.query-workspace",
          JSON.stringify({ version: 0, state: { navigatorVisible: true } }),
        );
      });
      await page.goto(`http://localhost:${server.port}/query/outline-perf`);
      await page.locator('.monaco-editor[role="code"]').waitFor();
      const navigator = page.getByRole("complementary", { name: "Query-Navigator" });
      await navigator.waitFor();
      await navigator.getByText(/\d+ \/ \d+ Tabellen/).waitFor();
      await page.waitForTimeout(500);
      const operationsBefore = await appRequestSnapshot(page);
      if (throttled) {
        const cdp = await page.context().newCDPSession(page);
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
        await page.evaluate(() => {
          const durations: number[] = [];
          Object.assign(window, { __outlineClickDurations: durations });
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              if (entry.name === "click") durations.push(entry.duration);
            }
          }).observe({ type: "event", durationThreshold: 16 });
        });
      }
      const coldOpenMs = await measureAppClick(
        page,
        navigator.getByRole("button", { name: "Statements", exact: true }),
        '[data-slot="query-statement-list"] [data-index="0"]',
      );
      await navigator.getByText("SELECT 0 AS value;", { exact: true }).waitFor();
      const initial = await page.evaluate(() => ({
        nodes: document.querySelectorAll("*").length,
        items: document.querySelectorAll('[aria-label="Query-Navigator"] [data-index]').length,
      }));
      console.log(`perf SQL outline: ${initial.nodes} DOM-Knoten, ${initial.items} Einträge`);
      if (throttled) {
        await page.waitForTimeout(100);
        const durations = await page.evaluate(
          () =>
            (window as unknown as { __outlineClickDurations: number[] }).__outlineClickDurations,
        );
        expect(durations.length).toBeGreaterThan(0);
        console.log(`perf SQL outline: ${Math.max(...durations)} ms Klick`);
      }
      expect(initial.nodes).toBeLessThan(5000);
      expect(initial.items).toBeLessThan(100);
      const list = navigator.locator('[data-slot="query-statement-list"]');
      await list.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      await navigator.getByText("SELECT 2999 AS value;", { exact: true }).waitFor();
      await navigator.getByText("Zeile 3000").waitFor();
      await navigator.getByText("SELECT 2999 AS value;", { exact: true }).click();
      const openSamples: number[] = [];
      for (let turn = 0; turn < 11; turn++) {
        await navigator.getByRole("button", { name: "Schema", exact: true }).click();
        await navigator.locator('[data-slot="query-schema-list"]').waitFor();
        const duration = await measureAppClick(
          page,
          navigator.getByRole("button", { name: "Statements", exact: true }),
          '[data-slot="query-statement-list"] [data-index]',
        );
        if (turn > 1) openSamples.push(duration);
      }
      const opens = interactionPercentiles(openSamples);
      const idleBefore = await appRequestSnapshot(page);
      await page.waitForTimeout(300);
      const idleAfter = await appRequestSnapshot(page);
      const operations = requestsSince(operationsBefore, idleBefore);
      const idle = requestsSince(idleBefore, idleAfter);
      const durations = throttled
        ? await page.evaluate(
            () =>
              (window as unknown as { __outlineClickDurations: number[] }).__outlineClickDurations,
          )
        : [];
      const worstClickMs = durations.length ? Math.max(...durations) : null;
      await reportScenario(`query-outline-${throttled ? "chromium" : "webkit"}`, {
        browser: browser.version(),
        cpuRate: throttled ? 4 : 1,
        statements: 3000,
        ...initial,
        coldOpenMs,
        opens,
        worstClickMs,
        startupCommands: requestCounts(operationsBefore.calls),
        operations,
        idleDurationMs: 300,
        idle,
        activeDatabaseRequests: idleAfter.activeDatabaseRequests,
        maxDatabaseConcurrency: idleAfter.maxDatabaseConcurrency,
      });
      expect(operations.databaseRequests).toBe(0);
      expect(operations.unknownRequests).toBe(0);
      expect(idle.databaseRequests).toBe(0);
      expect(idle.unknownRequests).toBe(0);
      expect(idleAfter.activeDatabaseRequests).toBe(0);
      expect(coldOpenMs).toBeLessThanOrEqual(120);
      expect(opens.p95Ms).toBeLessThanOrEqual(120);
      if (worstClickMs !== null) expect(worstClickMs).toBeLessThanOrEqual(120);
      expect(
        errors.filter(
          (error) => error !== "ResizeObserver loop completed with undelivered notifications.",
        ),
      ).toEqual([]);
    } finally {
      await browser.close();
      server.stop(true);
    }
  },
  60000,
);
