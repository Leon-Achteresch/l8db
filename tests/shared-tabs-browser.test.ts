import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { type Browser, chromium, type Page, webkit } from "playwright";
import { seedApp } from "./fixtures/perf-app";

const SHOTS = process.env.L8DB_SHARED_TABS_SHOTS;
const VIEW_KEY = JSON.stringify(["perf", "l8db_perf", "public", "table_0001"]);
const FILTER = `"col_1" = 'value 13'`;

async function recordInvokes(page: Page, clipboard = "") {
  await page.addInitScript((initial: string) => {
    const internals = (
      window as unknown as {
        __TAURI_INTERNALS__: { invoke: (...args: unknown[]) => Promise<unknown> };
      }
    ).__TAURI_INTERNALS__;
    const original = internals.invoke;
    const state = { calls: [] as { cmd: string; args: unknown }[], clipboard: initial };
    Object.assign(window, { __shared: state });
    internals.invoke = async (...call: unknown[]) => {
      const [cmd, args] = call as [string, Record<string, unknown>];
      state.calls.push({ cmd, args });
      if (cmd === "plugin:clipboard-manager|write_text") {
        state.clipboard = String(args?.text ?? "");
        return null;
      }
      if (cmd === "plugin:clipboard-manager|read_text") return state.clipboard;
      return original(...call);
    };
  }, clipboard);
}

const calls = (page: Page, command: string) =>
  page.evaluate(
    (command) =>
      (
        window as unknown as {
          __shared: { calls: { cmd: string; args: Record<string, unknown> }[] };
        }
      ).__shared.calls
        .filter((call) => call.cmd === command)
        .map((call) => call.args),
    command,
  );

const clipboardOf = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __shared: { clipboard: string } }).__shared.clipboard,
  );

async function shot(page: Page, options: { path: string }) {
  await page.waitForTimeout(400);
  await page.screenshot(options);
}

async function pasteOutsideInputs(page: Page, link: string) {
  await page.evaluate((link) => {
    (window as unknown as { __shared: { clipboard: string } }).__shared.clipboard = link;
    (document.activeElement as HTMLElement | null)?.blur();
  }, link);
  await page.keyboard.press("ControlOrMeta+V");
}

test.skipIf(!process.env.L8DB_SHARED_TABS_BROWSER)(
  "a colleague opens a shared filtered table and a shared script on their own connection",
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
    const engine = process.env.L8DB_SHARED_TABS_BROWSER === "webkit" ? webkit : chromium;
    const browser: Browser = await engine.launch({ headless: true });
    const base = `http://localhost:${server.port}`;
    try {
      const sender = await browser.newPage({ viewport: { width: 1400, height: 860 } });
      const errors: string[] = [];
      sender.on("pageerror", (error) => errors.push(error.message));
      await seedApp(sender, 5, { rows: 20, columns: 4 });
      await recordInvokes(sender);
      await sender.addInitScript(
        ({ key, filter }) => {
          if (sessionStorage.getItem("seeded")) return;
          sessionStorage.setItem("seeded", "1");
          localStorage.setItem(
            "l8db.table-tabs",
            JSON.stringify({
              version: 4,
              state: {
                tabsByConnection: {
                  perf: [
                    { kind: "table", schema: "public", table: "table_0001" },
                    {
                      kind: "query",
                      id: "umsatz",
                      title: "Umsatz",
                      sql: "select sum(col_1) as umsatz\nfrom public.table_0001\nwhere col_2 > 'ä'",
                    },
                  ],
                },
              },
            }),
          );
          localStorage.setItem(
            "l8db.table-view-state",
            JSON.stringify({
              version: 0,
              state: {
                lastDetailTab: "data",
                views: {
                  [key]: {
                    filter,
                    filterMode: "sql",
                    filterSql: filter,
                    filterOpen: true,
                    sorting: [{ id: "col_2", desc: true }],
                    page: 3,
                  },
                },
              },
            }),
          );
        },
        { key: VIEW_KEY, filter: FILTER },
      );
      await sender.goto(`${base}/tables/public/table_0001`);
      await sender.locator("tbody tr[data-index]").first().waitFor();

      const tableTab = sender.locator('[data-tab-key="table:public.table_0001"]');
      await tableTab.click({ button: "right" });
      const copy = sender.getByRole("menuitem", { name: "Link kopieren" });
      await copy.waitFor();
      if (SHOTS) await shot(sender, { path: `${SHOTS}/1-kontextmenue.png` });
      await copy.click();
      await sender.waitForFunction(() =>
        (window as unknown as { __shared: { clipboard: string } }).__shared.clipboard.startsWith(
          "l8db://tab/",
        ),
      );
      const tableLink = await clipboardOf(sender);
      expect(tableLink).not.toContain("leon");

      const queryTab = sender.locator('[data-tab-key="query:umsatz"]');
      await queryTab.click({ button: "right" });
      await sender.getByRole("menuitem", { name: "Link kopieren" }).click();
      await sender.waitForFunction(
        (previous) =>
          (window as unknown as { __shared: { clipboard: string } }).__shared.clipboard !==
          previous,
        tableLink,
      );
      const queryLink = await clipboardOf(sender);

      await queryTab.click({ button: "right" });
      await sender.getByRole("menuitem", { name: "Global speichern" }).click();
      const savedMenu = sender.getByRole("button", { name: "Gespeicherte Tabs (1)" });
      await savedMenu.click();
      const savedEntry = sender.getByRole("menuitem", { name: /Umsatz/ }).first();
      await savedEntry.waitFor();
      if (SHOTS) await shot(sender, { path: `${SHOTS}/2-gespeicherte-tabs.png` });
      await savedEntry.click();
      await sender.waitForFunction(
        () =>
          document.querySelectorAll('[data-tab-key^="query:"] button[title="Umsatz"]').length === 2,
      );
      expect(await sender.getByRole("dialog").count()).toBe(0);

      const context = await browser.newContext({ viewport: { width: 1400, height: 860 } });
      const colleague = await context.newPage();
      colleague.on("pageerror", (error) => errors.push(error.message));
      await seedApp(colleague, 5, { rows: 20, columns: 4 });
      await recordInvokes(colleague);
      await colleague.addInitScript(() => {
        localStorage.setItem(
          "l8db.connections",
          JSON.stringify({
            version: 0,
            state: {
              connections: [
                {
                  id: "other",
                  name: "Staging",
                  kind: "postgres",
                  connectionString: "postgresql://anna@staging.firma.de:5432/l8db_perf",
                  sslMode: "disable",
                },
                {
                  id: "kollege",
                  name: "Prod (Anna)",
                  kind: "postgres",
                  connectionString: "postgresql://anna@LOCALHOST:5432/l8db_perf",
                  sslMode: "disable",
                },
              ],
              activeId: "other",
              favoriteServerKeys: [],
              serverOrder: [],
            },
          }),
        );
      });
      await colleague.goto(`${base}/tables/public/table_0000`);
      await colleague.locator("tbody tr[data-index]").first().waitFor();

      await pasteOutsideInputs(colleague, tableLink);
      const dialog = colleague.getByRole("dialog");
      await dialog.waitFor();
      expect(await dialog.textContent()).toContain("public.table_0001");
      expect(await colleague.getByTestId("shared-tab-preview").textContent()).toBe(
        `WHERE ${FILTER}\nORDER BY col_2 DESC`,
      );
      expect(await dialog.getByRole("combobox", { name: "Verbindung" }).textContent()).toContain(
        "Prod (Anna)",
      );
      if (SHOTS) await shot(colleague, { path: `${SHOTS}/3-link-einfuegen.png` });
      await dialog.getByRole("button", { name: "Öffnen" }).click();
      const password = colleague.getByRole("dialog", { name: "Passwort erforderlich" });
      await password.waitFor();
      expect(await dialog.count()).toBe(1);
      await password.getByLabel("Passwort", { exact: true }).fill("annas-passwort");
      await password.getByRole("button", { name: "Verbinden" }).click();
      await dialog.waitFor({ state: "hidden" });
      await colleague.waitForURL(/\/tables\/public\/table_0001$/);
      await colleague.waitForFunction(
        (filter) =>
          (
            window as unknown as {
              __shared: { calls: { cmd: string; args: Record<string, unknown> }[] };
            }
          ).__shared.calls.some(
            (call) =>
              call.cmd === "fetch_table_rows" &&
              call.args.table === "table_0001" &&
              call.args.filter === filter,
          ),
        FILTER,
      );
      const fetched = (await calls(colleague, "fetch_table_rows")).filter(
        (args) => args.table === "table_0001" && args.filter === FILTER,
      );
      expect(String(fetched[0].connectionString)).toMatch(
        /^postgresql:\/\/anna.*@localhost:5432\/l8db_perf/i,
      );
      expect(fetched[0]).toMatchObject({
        orderBy: "col_2",
        orderDesc: true,
        offset: 0,
      });
      if (SHOTS) await shot(colleague, { path: `${SHOTS}/4-tabelle-gefiltert.png` });

      await pasteOutsideInputs(colleague, queryLink);
      await dialog.waitFor();
      expect(await colleague.getByTestId("shared-tab-preview").textContent()).toContain(
        "select sum(col_1) as umsatz",
      );
      await dialog.getByRole("button", { name: "Öffnen" }).click();
      await colleague.waitForURL(/\/query\//);
      await colleague.locator('[data-tab-key^="query:"] button[title="Umsatz"]').waitFor();
      await colleague.locator(".monaco-editor .view-lines").first().waitFor();
      const executed = await calls(colleague, "execute_query");
      expect(executed.some((args) => String(args.sql ?? "").includes("umsatz"))).toBe(false);

      await pasteOutsideInputs(colleague, "kein Link");
      await colleague.waitForTimeout(200);
      expect(await dialog.count()).toBe(0);
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
      server.stop(true);
    }
  },
  60_000,
);
