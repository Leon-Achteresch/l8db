import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { chromium, webkit } from "playwright";
import { seedApp } from "./fixtures/perf-app";

test.skipIf(!process.env.L8DB_PERF_APP)(
  "SQL-Statement-Navigator bleibt bei langen Skripten bedienbar",
  async () => {
    const server = Bun.serve({
      port: 0,
      fetch: async (request) => {
        const pathname = new URL(request.url).pathname;
        const file = Bun.file(resolve("dist", pathname.replace(/^\//, "")));
        return new Response(
          pathname !== "/" && (await file.exists()) ? file : Bun.file("dist/index.html"),
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
      await navigator.getByRole("button", { name: "Statements", exact: true }).click();
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
        expect(Math.max(...durations)).toBeLessThanOrEqual(120);
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
