import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { chromium, webkit } from "playwright";
import { seedApp } from "./fixtures/perf-app";

test.skipIf(!process.env.L8DB_PERF_APP)(
  "Schema-Navigator bleibt bei 3700 Objekten bedienbar",
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
      await page.goto(`http://localhost:${server.port}/query`);
      await page.locator('.monaco-editor[role="code"]').waitFor();
      await page.waitForTimeout(500);
      if (throttled) {
        const cdp = await page.context().newCDPSession(page);
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
        await page.evaluate(() => {
          const durations: number[] = [];
          Object.assign(window, { __navigatorClickDurations: durations });
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              if (entry.name === "click") durations.push(entry.duration);
            }
          }).observe({ type: "event", durationThreshold: 16 });
        });
      }
      await page.getByRole("button", { name: "Schema-Navigator umschalten" }).click();
      const navigator = page.getByRole("complementary", { name: "Query-Navigator" });
      await navigator.waitFor();
      await navigator.locator("details").first().waitFor();
      const initial = await page.evaluate(() => ({
        nodes: document.querySelectorAll("*").length,
        details: document.querySelectorAll('[aria-label="Query-Navigator"] details').length,
      }));
      expect(initial.nodes).toBeLessThan(5000);
      expect(initial.details).toBeLessThan(100);
      if (throttled) {
        await page.waitForTimeout(100);
        const durations = await page.evaluate(
          () =>
            (window as unknown as { __navigatorClickDurations: number[] })
              .__navigatorClickDurations,
        );
        expect(durations.length).toBeGreaterThan(0);
        const worst = Math.max(...durations);
        console.log(`perf Schema-Navigator: ${worst} ms Klick, ${initial.nodes} DOM-Knoten`);
        expect(worst).toBeLessThanOrEqual(120);
      }
      const list = navigator.locator('[data-slot="query-schema-list"]');
      await list.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      await navigator.getByText("v_table_0399", { exact: true }).waitFor();
      await list.evaluate((element) => {
        element.scrollTop = 0;
      });
      await navigator.locator("details summary").first().click();
      await navigator.getByRole("button", { name: "Tabellennamen einfügen" }).waitFor();
      await navigator.getByRole("textbox", { name: "Schema durchsuchen" }).fill("table_00");
      await navigator.getByText("300 / 3700 Tabellen").waitFor();
      const filtered = await page.evaluate(() => ({
        nodes: document.querySelectorAll("*").length,
        details: document.querySelectorAll('[aria-label="Query-Navigator"] details').length,
        open: document.querySelectorAll('[aria-label="Query-Navigator"] details[open]').length,
      }));
      expect(filtered.nodes).toBeLessThan(5000);
      expect(filtered.details).toBeLessThan(100);
      expect(filtered.open).toBeGreaterThan(0);
      await navigator.getByRole("textbox", { name: "Schema durchsuchen" }).fill("");
      await page.waitForFunction(
        () =>
          document.querySelectorAll('[aria-label="Query-Navigator"] details[open]').length === 1,
      );
      await navigator.getByRole("textbox", { name: "Schema durchsuchen" }).fill("col_1");
      await navigator.getByText("500 / 3700 Tabellen").waitFor();
      expect(await navigator.locator("details[open]").count()).toBeGreaterThan(0);
      expect(await page.evaluate(() => document.querySelectorAll("*").length)).toBeLessThan(5000);
      await navigator.getByRole("textbox", { name: "Schema durchsuchen" }).fill("table_2999");
      await navigator.getByText("table_2999", { exact: true }).waitFor();
      await navigator.getByRole("button", { name: "Statements", exact: true }).click();
      await navigator.getByText("Statements erscheinen hier, sobald du SQL schreibst.").waitFor();
      await navigator.getByRole("button", { name: "Schema", exact: true }).click();
      await navigator.getByText("table_2999", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Schema-Navigator umschalten" }).click();
      await navigator.waitFor({ state: "hidden" });
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
