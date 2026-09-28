import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { chromium, webkit } from "playwright";
import { seedApp } from "./fixtures/perf-app";

test.skipIf(!process.env.L8DB_PERF_APP)(
  "Query-Verlauf bleibt bei 5000 Einträgen bedienbar",
  async () => {
    const dist = "dist";
    const server = Bun.serve({
      port: 0,
      fetch: async (request) => {
        const pathname = new URL(request.url).pathname;
        const file = Bun.file(resolve(dist, pathname.replace(/^\//, "")));
        if (pathname !== "/" && (await file.exists())) return new Response(file);
        return new Response(Bun.file(resolve(dist, "index.html")), {
          headers: { "Content-Type": "text/html" },
        });
      },
    });
    const throttled = process.env.L8DB_PERF_ENGINE !== "webkit";
    const browser = await (throttled ? chromium : webkit).launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await seedApp(page, 3000);
      await page.addInitScript(() => {
        localStorage.setItem(
          "l8db.query-history",
          JSON.stringify({
            state: {
              retentionLimit: 5000,
              entries: Array.from({ length: 5000 }, (_, index) => ({
                id: `query-perf-${index}`,
                connectionId: "perf",
                database: "l8db_perf",
                sql: `SELECT ${index} FROM table_0000`,
                ranAt: Date.now() - index * 1000,
                durationMs: index % 100,
                rowCount: index,
                error: null,
              })),
            },
            version: 0,
          }),
        );
        localStorage.setItem(
          "l8db.saved-queries",
          JSON.stringify({
            state: {
              queries: Array.from({ length: 5000 }, (_, index) => ({
                id: `saved-perf-${index}`,
                name: `Gespeichert ${index}`,
                sql: `SELECT ${index}`,
                createdAt: Date.now() - index * 1000,
              })),
            },
            version: 0,
          }),
        );
      });
      await page.goto(`http://localhost:${server.port}/query`);
      await page.locator('.monaco-editor[role="code"]').waitFor();
      await page.waitForTimeout(500);
      await page.getByRole("button", { name: "Weitere Werkzeuge" }).click();
      if (throttled) {
        const cdp = await page.context().newCDPSession(page);
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
        await page.evaluate(() => {
          const durations: number[] = [];
          Object.assign(window, { __historyClickDurations: durations });
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              if (entry.name === "click") durations.push(entry.duration);
            }
          }).observe({ type: "event", durationThreshold: 16 });
        });
      }
      await page.getByRole("menuitem", { name: /Verlauf & Gespeichertes/ }).click();
      await page.getByRole("dialog", { name: "Verlauf & Gespeichertes" }).waitFor();
      await page.getByText("SELECT 0 FROM table_0000", { exact: true }).waitFor();
      const initial = await page.evaluate(() => ({
        nodes: document.querySelectorAll("*").length,
        entries: document.querySelectorAll('[data-slot="query-history-list"] [data-index]').length,
      }));
      expect(initial.nodes).toBeLessThan(5000);
      expect(initial.entries).toBeLessThan(100);
      if (throttled) {
        await page.waitForTimeout(100);
        const durations = await page.evaluate(
          () =>
            (window as unknown as { __historyClickDurations: number[] }).__historyClickDurations,
        );
        expect(durations.length).toBeGreaterThan(0);
        const worst = Math.max(...durations);
        console.log(`perf query history: ${worst} ms Klick, ${initial.nodes} DOM-Knoten`);
        expect(worst).toBeLessThanOrEqual(120);
      }
      const list = page.locator('[data-slot="query-history-list"]');
      await list.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      await page.getByText("SELECT 4999 FROM table_0000", { exact: true }).waitFor();
      await page.getByRole("textbox", { name: "Query-Verlauf durchsuchen" }).fill("SELECT 4999");
      await page.getByText("SELECT 4999 FROM table_0000", { exact: true }).waitFor();
      await page.getByRole("textbox", { name: "Query-Verlauf durchsuchen" }).fill("");
      await page
        .getByRole("radiogroup", { name: "Query-Bibliothek" })
        .getByText("Gespeichert")
        .click();
      await page.getByText("Gespeichert 0", { exact: true }).waitFor();
      await list.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      await page.getByText("Gespeichert 4999", { exact: true }).waitFor();
      expect(await page.evaluate(() => document.querySelectorAll("*").length)).toBeLessThan(5000);
      await page
        .getByRole("textbox", { name: "Query-Verlauf durchsuchen" })
        .fill("Gespeichert 4999");
      await page.getByText("Gespeichert 4999", { exact: true }).waitFor();
      if (throttled) {
        await page.waitForTimeout(100);
        const durations = await page.evaluate(
          () =>
            (window as unknown as { __historyClickDurations: number[] }).__historyClickDurations,
        );
        console.log(`perf query history actions: ${durations.join(", ")} ms`);
        expect(Math.max(...durations)).toBeLessThanOrEqual(120);
      }
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
