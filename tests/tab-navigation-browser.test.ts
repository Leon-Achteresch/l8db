import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { chromium, webkit } from "playwright";
import { seedApp } from "./fixtures/perf-app";

for (const intent of ["focus", "hover"] as const) {
  test.skipIf(!process.env.L8DB_TAB_BROWSER)(
    `tabs preload on ${intent}, respond while loading and recover after rapid navigation`,
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
      const engine = process.env.L8DB_TAB_BROWSER === "webkit" ? webkit : chromium;
      const browser = await engine.launch({ headless: true });
      let release = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      try {
        const page = await browser.newPage();
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await seedApp(page, 5, { rows: 20, columns: 4 });
        await page.addInitScript(() => {
          const tabs = [
            { kind: "table", schema: "public", table: "table_0000" },
            { kind: "table", schema: "public", table: "table_0001" },
            { kind: "query", id: "latency", title: "Latency", sql: "select 1" },
          ];
          localStorage.setItem(
            "l8db.table-tabs",
            JSON.stringify({
              version: 4,
              state: { tabsByConnection: { perf: tabs } },
            }),
          );
        });
        await page.route("**/assets/query-view-*.js", async (route) => {
          await gate;
          await route.continue();
        });
        await page.goto(`http://localhost:${server.port}/tables/public/table_0000`);
        await page.locator("tbody tr[data-index]").first().waitFor();
        const query = page.locator('[data-tab-key="query:latency"] button[title]');
        const table = page.locator('[data-tab-key="table:public.table_0000"] button[title]');
        await page.waitForFunction(() =>
          document.querySelector('[data-tab-key="table:public.table_0000"] [aria-current="page"]'),
        );
        const preload = page.waitForRequest(/\/assets\/query-view-.*\.js/, { timeout: 10000 });
        await query[intent]();
        await preload;
        expect(await table.getAttribute("aria-current")).toBe("page");
        await query.press("Enter");
        await page
          .getByRole("status")
          .filter({ hasText: "wird geöffnet" })
          .waitFor({ timeout: 500 });
        expect(await query.getAttribute("aria-current")).toBe("page");
        expect(await query.getAttribute("aria-busy")).toBe("true");
        expect(
          await page.locator("tbody").evaluate((element) => Boolean(element.closest("[inert]"))),
        ).toBe(true);
        await table.click();
        await page
          .getByRole("status")
          .filter({ hasText: "wird geöffnet" })
          .waitFor({ state: "hidden", timeout: 1000 });
        expect(await table.getAttribute("aria-current")).toBe("page");
        release();
        await query.click();
        await page.locator('[data-tour="query-toolbar"]').waitFor();
        await page.waitForFunction(
          () => !document.querySelector('[data-tab-key="query:latency"] [aria-busy="true"]'),
        );
        await table.click();
        await page.locator("tbody tr[data-index]").first().waitFor();
        expect(await table.getAttribute("aria-current")).toBe("page");
        expect(errors).toEqual([]);
      } finally {
        release();
        await browser.close();
        server.stop(true);
      }
    },
    60000,
  );
}
