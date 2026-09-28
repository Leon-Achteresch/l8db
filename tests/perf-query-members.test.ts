import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { chromium, webkit } from "playwright";
import { seedApp } from "./fixtures/perf-app";

test.skipIf(!process.env.L8DB_PERF_APP)(
  "Package-Mitglieder bleiben bei 3000 Funktionen bedienbar",
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
      await page.addInitScript(() => {
        const members = Array.from(
          { length: 3000 },
          (_, index) => `FUNCTION fn_${String(index).padStart(4, "0")} RETURN NUMBER;`,
        );
        const sql = `CREATE PACKAGE perf_pkg AS\n${members.join("\n")}\nEND perf_pkg;`;
        localStorage.setItem(
          "l8db.table-tabs",
          JSON.stringify({
            version: 4,
            state: {
              tabsByConnection: {
                perf: [{ kind: "query", id: "members-perf", title: "Members Perf", sql }],
              },
            },
          }),
        );
      });
      await page.goto(`http://localhost:${server.port}/query/members-perf`);
      await page.locator('.monaco-editor[role="code"]').waitFor();
      await page.waitForTimeout(500);
      if (throttled) {
        const cdp = await page.context().newCDPSession(page);
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
        await page.evaluate(() => {
          const durations: number[] = [];
          Object.assign(window, { __memberClickDurations: durations });
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              if (entry.name === "click") durations.push(entry.duration);
            }
          }).observe({ type: "event", durationThreshold: 16 });
        });
      }
      await page.getByRole("button", { name: "Schema-Navigator umschalten" }).click();
      const navigator = page.getByRole("complementary", { name: "Package-Mitglieder" });
      await navigator.waitFor();
      await navigator.getByText("FN_0000", { exact: true }).waitFor();
      const initial = await page.evaluate(() => ({
        nodes: document.querySelectorAll("*").length,
        items: document.querySelectorAll('[data-slot="query-member-list"] [data-index]').length,
      }));
      console.log(
        `perf Package-Mitglieder: ${initial.nodes} DOM-Knoten, ${initial.items} Einträge`,
      );
      if (throttled) {
        await page.waitForTimeout(100);
        const durations = await page.evaluate(
          () => (window as unknown as { __memberClickDurations: number[] }).__memberClickDurations,
        );
        expect(durations.length).toBeGreaterThan(0);
        console.log(`perf Package-Mitglieder: ${Math.max(...durations)} ms Klick`);
        expect(Math.max(...durations)).toBeLessThanOrEqual(120);
      }
      expect(initial.nodes).toBeLessThan(5000);
      expect(initial.items).toBeLessThan(100);
      const list = navigator.locator('[data-slot="query-member-list"]');
      await list.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      await navigator.getByText("FN_2999", { exact: true }).waitFor();
      await navigator.getByRole("textbox", { name: "Mitglieder filtern" }).fill("FN_2999");
      await navigator.getByText("FN_2999", { exact: true }).click();
      await navigator.getByRole("textbox", { name: "Mitglieder filtern" }).fill("");
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
