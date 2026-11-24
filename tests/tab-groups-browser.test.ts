import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { chromium, type Page, webkit } from "playwright";
import { seedApp } from "./fixtures/perf-app";

const dist = process.env.L8DB_TAB_DIST ?? "dist";
const shots = process.env.L8DB_TAB_SHOTS;

const table = (index: number) => `table_${String(index).padStart(4, "0")}`;
const key = (index: number) => `table:public.${table(index)}`;

async function shot(page: Page, name: string) {
  if (!shots) return;
  await page.waitForTimeout(300);
  await page.screenshot({ path: resolve(shots, `${name}.png`) });
}

test.skipIf(!process.env.L8DB_TAB_BROWSER)(
  "Tab-Gruppen speichern, umbenennen, schließen und aus einer anderen Verbindung öffnen",
  async () => {
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
    const engine = process.env.L8DB_TAB_BROWSER === "webkit" ? webkit : chromium;
    const browser = await engine.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await seedApp(page, 12, { rows: 20, columns: 4 });
      await page.addInitScript(() => {
        const connections = JSON.parse(localStorage.getItem("l8db.connections") ?? "{}");
        connections.state.connections.push({
          id: "other",
          name: "Staging",
          kind: "postgres",
          connectionString: "postgresql://leon:geheim@staging.example.com:5432/l8db_perf",
          sslMode: "disable",
        });
        localStorage.setItem("l8db.connections", JSON.stringify(connections));
        if (sessionStorage.getItem("seeded")) return;
        sessionStorage.setItem("seeded", "1");
        const name = (index: number) => `table_${String(index).padStart(4, "0")}`;
        const tab = (index: number) => ({
          kind: "table",
          schema: "public",
          table: name(index),
          entityType: "table",
        });
        localStorage.setItem(
          "l8db.table-tabs",
          JSON.stringify({
            version: 4,
            state: { tabsByConnection: { perf: [0, 1, 2, 3].map(tab) } },
          }),
        );
        const draft = { kind: "query", id: "q1", title: "Prüfen", sql: "" };
        localStorage.setItem(
          "l8db.split-view",
          JSON.stringify({
            version: 0,
            state: {
              byConnection: {},
              groups: {
                other: [
                  {
                    id: "orders",
                    name: "Bestellungen",
                    tabs: [tab(4), tab(5)],
                    paneTabs: [
                      [tab(4), tab(6)],
                      [tab(5), draft],
                    ],
                    masters: [null, 0],
                    orientation: "horizontal",
                    focusedPane: 0,
                    shared: true,
                  },
                  {
                    id: "there",
                    name: "Nur dort",
                    tabs: [tab(7)],
                    paneTabs: [[tab(7), tab(8)]],
                    masters: [null],
                    orientation: "horizontal",
                    focusedPane: 0,
                    shared: true,
                  },
                ],
              },
              closedTabs: { other: { "query:q1": { ...draft, sql: "SELECT 4711" } } },
            },
          }),
        );
      });
      await page.goto(`http://localhost:${server.port}/tables/public/${table(0)}`);
      const master = "nav[aria-label='Geöffnete Objekte'] [data-tab-key]";
      await page.locator(master).nth(3).waitFor();

      const masterKeys = () =>
        page.evaluate(
          (selector) =>
            Array.from(document.querySelectorAll(selector), (el) =>
              el.getAttribute("data-tab-key"),
            ),
          master,
        );
      const paneKeys = () =>
        page.evaluate(() =>
          [0, 1].map((pane) =>
            Array.from(
              document.querySelectorAll(`[data-pane-strip='${pane}'] [data-tab-key]`),
              (el) => el.getAttribute("data-tab-key"),
            ),
          ),
        );
      const stored = () =>
        page.evaluate(() => JSON.parse(localStorage.getItem("l8db.split-view") ?? "{}").state);
      const trigger = page.locator("button[aria-label^='Tab-Gruppen']");
      const menu = page.locator("[role='menu']");
      const row = (name: string) => page.locator(`[role='menuitem'][title^='${name}:']`);
      const input = page.locator("input[aria-label='Name der Tab-Gruppe']");
      const openMenu = async () => {
        await trigger.click();
        await menu.waitFor();
      };
      const closeMenu = async () => {
        await page.keyboard.press("Escape");
        await menu.waitFor({ state: "detached" });
      };
      const closeTab = (index: number) =>
        page
          .locator(`${master}[data-tab-key='${key(index)}'] button[aria-label$='schließen']`)
          .click();

      expect(await trigger.getAttribute("aria-label")).toBe("Tab-Gruppen (2)");
      await openMenu();
      await shot(page, "01-menu");
      expect(await row("Bestellungen").getAttribute("title")).toBe(
        `Bestellungen: Staging · ${table(4)} +1 | ${table(5)} +1`,
      );

      await page.getByRole("menuitem", { name: "Offene Tabs als Gruppe speichern" }).click();
      await input.waitFor();
      expect(await input.inputValue()).toBe("Gruppe 1");
      await row("Bestellungen").hover();
      await page.mouse.move(900, 500);
      expect(await input.evaluate((element) => element === document.activeElement)).toBe(true);
      await page.keyboard.type("Kunden");
      await shot(page, "02-benennen");
      await page.keyboard.press("Enter");
      await row("Kunden").waitFor();
      expect(await menu.count()).toBe(1);
      expect(await row("Kunden").getAttribute("title")).toBe(
        `Kunden: ${[0, 1, 2, 3].map(table).join(", ")}`,
      );
      expect((await stored()).groups.perf[0]).toMatchObject({ name: "Kunden" });
      expect((await stored()).groups.perf[0].paneTabs[0]).toHaveLength(4);
      await closeMenu();
      expect(await trigger.getAttribute("aria-label")).toBe("Tab-Gruppen (3)");

      for (const index of [3, 2, 1, 0]) await closeTab(index);
      await page.waitForFunction((selector) => !document.querySelector(selector), master);
      await openMenu();
      await row("Kunden").click();
      await page.locator(master).nth(3).waitFor();
      expect(await masterKeys()).toEqual([0, 1, 2, 3].map(key));
      await page.waitForURL(new RegExp(table(0)));
      expect(await page.locator("[data-pane-strip]").count()).toBe(0);

      await closeTab(3);
      await page.waitForFunction(
        (selector) => document.querySelectorAll(selector).length === 3,
        master,
      );
      await openMenu();
      await page
        .getByRole("menuitem", { name: "Kunden mit den offenen Tabs überschreiben" })
        .click();
      await page
        .locator(`[role='menuitem'][title='Kunden: ${[0, 1, 2].map(table).join(", ")}']`)
        .waitFor();

      await page.getByRole("menuitem", { name: "Kunden umbenennen" }).click();
      await input.waitFor();
      await page.keyboard.type("Verworfen");
      await page.keyboard.press("Escape");
      await input.waitFor({ state: "detached" });
      expect(await menu.count()).toBe(1);
      expect(await row("Kunden").count()).toBe(1);
      await page.getByRole("menuitem", { name: "Kunden umbenennen" }).click();
      await input.waitFor();
      await page.keyboard.type("Stammdaten");
      await page.mouse.click(400, 600);
      await menu.waitFor({ state: "detached" });
      expect((await stored()).groups.perf[0].name).toBe("Stammdaten");
      await openMenu();
      await row("Stammdaten").waitFor();
      expect(await row("Kunden").count()).toBe(0);

      await row("Bestellungen").hover();
      await shot(page, "03-zeile");
      await row("Bestellungen").click();
      await page.locator("[data-pane-strip='1'] [data-tab-key]").nth(1).waitFor();
      const panes = await paneKeys();
      expect(panes[0]).toEqual([key(4), key(6)]);
      expect(panes[1][0]).toBe(key(5));
      expect(panes[1][1]).toMatch(/^query:/);
      expect(panes[1][1]).not.toBe("query:q1");
      expect(await masterKeys()).toEqual([0, 1, 2].map(key));
      await page.waitForFunction(
        () => JSON.parse(localStorage.getItem("l8db.table-tabs") ?? "{}").state?.tabsByConnection,
      );
      await page.waitForFunction(() =>
        (
          JSON.parse(localStorage.getItem("l8db.table-tabs") ?? "{}").state.tabsByConnection.perf ??
          []
        ).some((tab: { sql?: string }) => tab.sql === "SELECT 4711"),
      );
      const adopted = await stored();
      expect(adopted.groups.perf.map((group: { name: string }) => group.name)).toEqual([
        "Stammdaten",
        "Bestellungen",
      ]);
      expect(adopted.groups.perf[1].origin).toBe("orders");
      expect(adopted.groups.other).toHaveLength(2);
      expect(adopted.closedTabs.perf).toEqual({});
      expect(await trigger.getAttribute("aria-label")).toBe("Tab-Gruppen (3)");
      await shot(page, "04-uebernommen");

      const chip = page.locator("button[title^='Bestellungen:']").first();
      await chip.click({ button: "right" });
      await page.getByRole("menuitem", { name: "Gruppe schließen" }).click();
      await page.waitForFunction(() => !document.querySelector("[data-pane-strip]"));
      await page.waitForFunction(
        (selector) => document.querySelectorAll(selector).length === 3,
        master,
      );
      expect(await masterKeys()).toEqual([0, 1, 2].map(key));
      const closed = await stored();
      expect(closed.groups.perf[1].paneTabs.map((tabs: unknown[]) => tabs.length)).toEqual([2, 2]);
      expect(Object.values(closed.closedTabs.perf)).toMatchObject([{ sql: "SELECT 4711" }]);

      await page.reload();
      await page.locator(master).nth(2).waitFor();
      await openMenu();
      await row("Bestellungen").click();
      await page.locator("[data-pane-strip='1'] [data-tab-key]").nth(1).waitFor();
      expect((await paneKeys()).map((keys) => keys.length)).toEqual([2, 2]);
      expect((await paneKeys())[0]).toEqual([key(4), key(6)]);

      await openMenu();
      await page.getByRole("menuitem", { name: "Tab-Gruppe Stammdaten löschen" }).click();
      await row("Stammdaten").waitFor({ state: "detached" });
      await closeMenu();
      expect(await trigger.getAttribute("aria-label")).toBe("Tab-Gruppen (2)");

      await openMenu();
      await page.getByRole("menuitem", { name: "Nur dort in Staging öffnen" }).click();
      await page.waitForFunction(
        () =>
          JSON.parse(localStorage.getItem("l8db.connections") ?? "{}").state.activeId === "other",
      );
      await page.locator(master).nth(1).waitFor();
      expect(await masterKeys()).toEqual([key(7), key(8)]);
      await page.waitForURL(new RegExp(table(7)));
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
      server.stop(true);
    }
  },
  90_000,
);
