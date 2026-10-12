import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { chromium, webkit } from "playwright";
import { seedApp } from "./fixtures/perf-app";

test.skipIf(!process.env.L8DB_PERF_APP)(
  "Monitor-Log bleibt bei 5000 Queries bedienbar",
  async () => {
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
                id: `perf-monitor-${index}`,
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
      });
      await page.goto(`http://localhost:${server.port}/monitor`);
      await page.locator('[data-tour="monitor"]').waitFor();
      await page.waitForTimeout(500);
      if (throttled) {
        const cdp = await page.context().newCDPSession(page);
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
        await page.evaluate(() => {
          const durations: number[] = [];
          Object.assign(window, { __logClickDurations: durations });
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              if (entry.name === "click") durations.push(entry.duration);
            }
          }).observe({ type: "event", durationThreshold: 16 });
        });
      }
      await page.getByRole("tab", { name: "Logs", exact: true }).click();
      await page.getByRole("tabpanel", { name: "Logs" }).getByText("Query-Log").waitFor();
      await page.getByText("SELECT 0 FROM table_0000", { exact: true }).waitFor();
      const initial = await page.evaluate(() => ({
        rows: document.querySelectorAll(
          '[role="tabpanel"][data-state="active"] button[aria-expanded]',
        ).length,
        nodes: document.querySelectorAll("*").length,
      }));
      expect(initial.rows).toBeLessThan(120);
      expect(initial.nodes).toBeLessThan(5000);
      if (throttled) {
        await page.waitForTimeout(100);
        const durations = await page.evaluate(
          () => (window as unknown as { __logClickDurations: number[] }).__logClickDurations,
        );
        expect(durations.length).toBeGreaterThan(0);
        const worst = Math.max(...durations);
        console.log(`perf monitor log: ${worst} ms Klick, ${initial.nodes} DOM-Knoten`);
        expect(worst).toBeLessThanOrEqual(120);
      }
      await page.getByRole("combobox", { name: "Query-Log-Seite" }).selectOption("49");
      await page.getByText("SELECT 4999 FROM table_0000", { exact: true }).waitFor();
      expect(await page.getByText("SELECT 0 FROM table_0000", { exact: true }).count()).toBe(0);
      if (throttled) {
        await page.waitForTimeout(100);
        const durations = await page.evaluate(
          () => (window as unknown as { __logClickDurations: number[] }).__logClickDurations,
        );
        console.log(`perf monitor log pages: ${durations.join(", ")} ms`);
        expect(Math.max(...durations)).toBeLessThanOrEqual(120);
      }
      await page.getByRole("textbox", { name: "Query-Log durchsuchen" }).fill("SELECT 4999");
      await page.getByText("SELECT 4999 FROM table_0000", { exact: true }).waitFor();
      expect(await page.getByRole("combobox", { name: "Query-Log-Seite" }).count()).toBe(0);
      await page.evaluate(() => {
        const internals = (
          window as unknown as {
            __TAURI_INTERNALS__: {
              invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
            };
          }
        ).__TAURI_INTERNALS__;
        const invoke = internals.invoke;
        let delivered = false;
        internals.invoke = (command, args) => {
          if (command === "take_server_output") {
            if (delivered) return Promise.resolve([]);
            delivered = true;
            return Promise.resolve(
              Array.from({ length: 1000 }, (_, index) => ({
                level: "NOTICE",
                message: `Meldung ${index}`,
                detail: null,
              })),
            );
          }
          return invoke(command, args);
        };
      });
      await page.getByRole("switch", { name: "Server-Ausgabe aktivieren" }).click();
      await page.getByText("Meldung 999", { exact: true }).waitFor();
      expect(await page.getByText("Meldung 0", { exact: true }).count()).toBe(0);
      await page.getByRole("combobox", { name: "Server-Ausgabe-Seite" }).selectOption("9");
      await page.getByText("Meldung 0", { exact: true }).waitFor();
      expect(await page.getByText("Meldung 999", { exact: true }).count()).toBe(0);
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
