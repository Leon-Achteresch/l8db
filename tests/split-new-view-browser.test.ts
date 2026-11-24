import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { chromium, webkit } from "playwright";
import { seedApp } from "./fixtures/perf-app";

test.skipIf(!process.env.L8DB_TAB_BROWSER)(
  "Ansicht teilen aus einem eigenständigen Tab legt eine neue geteilte Ansicht an",
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
    try {
      const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await seedApp(page, 10, { rows: 20, columns: 4 });
      await page.addInitScript(() => {
        if (sessionStorage.getItem("seeded")) return;
        sessionStorage.setItem("seeded", "1");
        const keys = Array.from({ length: 4 }, (_, i) => `table_${String(i).padStart(4, "0")}`);
        localStorage.setItem(
          "l8db.table-tabs",
          JSON.stringify({
            version: 4,
            state: {
              tabsByConnection: {
                perf: keys.map((table) => ({ kind: "table", schema: "public", table })),
              },
            },
          }),
        );
        const [first, second] = keys.map((table) => `table:public.${table}`);
        localStorage.setItem(
          "l8db.split-view",
          JSON.stringify({
            version: 0,
            state: {
              byConnection: {
                perf: { version: 2, panes: [first, second], paneTabs: [[first], [second]] },
              },
            },
          }),
        );
      });
      await page.goto(`http://localhost:${server.port}/tables/public/table_0000`);
      await page.locator("[data-pane-strip='1'] [data-tab-key]").first().waitFor();

      const paneKeys = () =>
        page.evaluate(() =>
          [0, 1, 2].map((pane) =>
            Array.from(
              document.querySelectorAll(`[data-pane-strip='${pane}'] [data-tab-key]`),
              (el) => el.getAttribute("data-tab-key"),
            ),
          ),
        );
      const masterKeys = () =>
        page.evaluate(() =>
          Array.from(
            document.querySelectorAll("nav[aria-label='Geöffnete Objekte'] [data-tab-key]"),
            (el) => el.getAttribute("data-tab-key"),
          ),
        );
      const groups = async () => {
        await page.locator("button[aria-label^='Tab-Gruppen (']").click();
        const items = page.locator("[role='menuitem'][title^='Ansicht ']");
        await items.first().waitFor();
        const titles = await items.evaluateAll((items) =>
          items.map((item) => item.getAttribute("title")),
        );
        await page.keyboard.press("Escape");
        await page.locator("[role='menu']").waitFor({ state: "detached" });
        return titles;
      };

      expect(await paneKeys()).toEqual([
        ["table:public.table_0000"],
        ["table:public.table_0001"],
        [],
      ]);
      expect(await masterKeys()).toEqual(["table:public.table_0002", "table:public.table_0003"]);

      await page
        .locator(
          "nav[aria-label='Geöffnete Objekte'] [data-tab-key='table:public.table_0003'] > button[title]",
        )
        .click();
      await page.waitForFunction(() => !document.querySelector("[data-pane-strip]"));
      await page.waitForURL(/table_0003/);

      await page.locator("button[aria-label='Ansicht teilen']").click();
      await page.locator("[data-pane-strip='1']").waitFor();
      await page.waitForTimeout(200);
      expect(await paneKeys()).toEqual([["table:public.table_0003"], [], []]);
      expect((await masterKeys()).sort()).toEqual([
        "table:public.table_0000",
        "table:public.table_0001",
        "table:public.table_0002",
      ]);
      expect(await groups()).toEqual([
        "Ansicht 1: table_0000 | table_0001",
        "Ansicht 2: table_0003 | Leer",
      ]);

      await page.locator("button[aria-label='Tab-Gruppen (2)']").click();
      await page
        .getByRole("menuitem", { name: /Ansicht 1/ })
        .first()
        .click();
      await page.locator("[role='menu']").waitFor({ state: "detached" });
      await page.waitForFunction(() =>
        document
          .querySelector("[data-pane-strip='1'] [data-tab-key]")
          ?.getAttribute("data-tab-key")
          ?.endsWith("table_0001"),
      );
      expect(await paneKeys()).toEqual([
        ["table:public.table_0000"],
        ["table:public.table_0001"],
        [],
      ]);
      expect(await groups()).toEqual([
        "Ansicht 1: table_0000 | table_0001",
        "Ansicht 2: table_0003 | Leer",
      ]);

      await page.locator("button[aria-label='Ansicht teilen']").click();
      await page.locator("[data-pane-strip='2']").waitFor();
      expect(await groups()).toHaveLength(2);
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
      server.stop(true);
    }
  },
  60_000,
);
