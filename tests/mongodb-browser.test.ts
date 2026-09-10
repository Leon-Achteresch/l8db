import { expect, test } from "bun:test";
import { chromium, webkit } from "playwright";

const database = "l8db_browser_integration_long_database_name";

test.skipIf(!process.env.L8DB_MONGODB_BROWSER)(
  "MongoDB: real adapter, collections, JSON filter, query and scope layout",
  async () => {
    const browser = await (process.env.L8DB_MONGODB_WEBKIT ? webkit : chromium).launch({
      headless: true,
    });
    const page = await browser.newPage({ viewport: { width: 1200, height: 850 } });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(
      ({ database }) => {
        localStorage.setItem(
          "l8db.settings",
          JSON.stringify({ state: { tourFinished: true }, version: 0 }),
        );
        localStorage.setItem(
          "l8db.connections",
          JSON.stringify({
            state: {
              connections: [
                {
                  id: "mongo-lab",
                  name: "MongoDB Docker Lab",
                  kind: "mongodb",
                  connectionString: `mongodb://l8db:l8db_test_only@127.0.0.1:27018/${database}?authSource=admin`,
                  sslMode: "disable",
                  ssh: null,
                  schemas: [database],
                },
              ],
              activeId: "mongo-lab",
            },
            version: 0,
          }),
        );
        localStorage.setItem(
          "l8db.db-selection",
          JSON.stringify({
            state: { databaseByConnection: {}, schemaByConnection: { "mongo-lab": "public" } },
            version: 0,
          }),
        );
        const host = window as unknown as { __TAURI_INTERNALS__: unknown; mongoCalls: unknown[] };
        host.mongoCalls = [];
        host.__TAURI_INTERNALS__ = {
          transformCallback: () => 1,
          unregisterCallback: () => {},
          metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
          invoke: async (command: string, args: Record<string, unknown> = {}) => {
            if (command.endsWith("secret"))
              return command === "load_secret" ? "l8db_test_only" : null;
            if (
              command.startsWith("plugin:") ||
              command.includes("extension") ||
              command === "list_ssh_tunnels"
            )
              return [];
            host.mongoCalls.push({ command, args });
            const response = await fetch("http://127.0.0.1:27019", {
              method: "POST",
              body: JSON.stringify({ command, args }),
            });
            const value = await response.json();
            if (value.error) throw Error(value.error);
            return value.result;
          },
        };
      },
      { database },
    );
    try {
      await page.goto("http://localhost:1420");
      await page.getByRole("combobox", { name: "Datenbank", exact: true }).waitFor();
      await page.getByText("items", { exact: true }).first().waitFor();
      await page.screenshot({ path: "/tmp/l8db-mongo-sidebar.png" });

      const scope = page.locator('[data-tour="sidebar-scope"]');
      expect(await scope.getByRole("combobox").count()).toBe(1);
      for (const width of [900, 1200, 1600]) {
        await page.setViewportSize({ width, height: 850 });
        expect(await scope.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
        const trigger = scope.getByRole("combobox");
        expect(await trigger.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
      }
      await page.evaluate(async () => {
        const { useProvidersStore } = await import("/src/lib/providers.ts");
        useProvidersStore.setState((state) => ({
          providers: state.providers.map((provider) =>
            provider.kind === "mongodb"
              ? { ...provider, capabilities: { ...provider.capabilities, query_language: "sql" } }
              : provider,
          ),
        }));
      });
      await page.getByRole("combobox", { name: "Schema", exact: true }).waitFor();
      for (const width of [900, 1200, 1600]) {
        await page.setViewportSize({ width, height: 850 });
        const dbBox = await scope
          .getByRole("combobox", { name: "Datenbank", exact: true })
          .boundingBox();
        const schemaBox = await scope
          .getByRole("combobox", { name: "Schema", exact: true })
          .boundingBox();
        expect(schemaBox!.y).toBeGreaterThan(dbBox!.y + dbBox!.height);
        expect(await scope.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
        expect(
          await scope
            .getByRole("combobox", { name: "Schema", exact: true })
            .evaluate((node) => node.scrollWidth <= node.clientWidth),
        ).toBe(true);
      }
      await page.screenshot({ path: "/tmp/l8db-scope-two-fields.png" });
      await page.evaluate(async () => {
        const { loadProviders } = await import("/src/lib/providers.ts");
        await loadProviders();
      });
      await page.getByText("items", { exact: true }).first().click();
      await page.getByRole("tab", { name: "Columns", exact: true }).click();
      await page.getByText("Primary Keys", { exact: true }).first().waitFor();
      await page.getByRole("tab", { name: "Indexes", exact: true }).click();
      await page.getByText("_id_", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Neuer Index", exact: true }).click();
      const indexCommand = page.getByRole("textbox", { name: "Index-Befehl", exact: true });
      expect(JSON.parse(await indexCommand.inputValue()).createIndexes).toBe("items");
      await indexCommand.fill(
        '{"createIndexes":"items","indexes":[{"key":{"status":1},"name":"status_browser"}]}',
      );
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Ausführen", exact: true })
        .click();
      await page.getByText("status_browser", { exact: true }).waitFor();
      await page.getByRole("tab", { name: "Daten", exact: true }).click();

      await page.getByRole("button", { name: "Filter", exact: true }).click();
      await page.getByRole("textbox", { name: "MongoDB-Filter" }).fill('{"n":{"$gte":250}}');
      await page.getByRole("button", { name: "Filter anwenden", exact: true }).click();
      await page.getByText("250", { exact: true }).first().waitFor();
      await page.screenshot({ path: "/tmp/l8db-mongo-filter.png" });

      await page.getByRole("textbox", { name: "MongoDB-Filter" }).fill("n = 1");
      await page.getByRole("button", { name: "Filter anwenden", exact: true }).click();
      await page
        .getByText(/Der Filter muss gültiges JSON sein/)
        .first()
        .waitFor();
      await page.getByRole("button", { name: "Zurücksetzen", exact: true }).click();
      await page.getByText("1–100 von 257", { exact: true }).waitFor();
      await page.locator('[data-tour="sidebar-table"]').click({ button: "right" });
      expect(await page.getByRole("menuitem", { name: "Alter Table", exact: true }).count()).toBe(
        0,
      );
      await page.getByRole("menuitem", { name: "Im Editor öffnen", exact: true }).click();
      await page.getByRole("button", { name: "Ausführen", exact: true }).click();
      await page.getByText("257 Zeilen", { exact: false }).first().waitFor();
      await page.getByText('{"value":0}', { exact: true }).first().waitFor();
      await page.getByRole("textbox", { name: "Ergebnisse durchsuchen" }).fill('"value":250');
      await page.getByText('{"value":250}', { exact: true }).first().waitFor();
      expect(await page.getByText("[object Object]", { exact: true }).count()).toBe(0);
      await page.getByRole("textbox", { name: "Ergebnisse durchsuchen" }).fill("");
      await page.screenshot({ path: "/tmp/l8db-mongo-query.png" });
      await page.getByRole("combobox", { name: "Datenbank", exact: true }).click();
      await page.getByRole("option", { name: "l8db_browser_second", exact: true }).click();
      await page.getByText("other", { exact: true }).first().waitFor();
      const collectionCalls = await page.evaluate(() =>
        (
          window as unknown as { mongoCalls: { command: string; args: Record<string, unknown> }[] }
        ).mongoCalls.filter((call) => call.command === "list_tables"),
      );
      expect(collectionCalls.some((call) => call.args.schema === "public")).toBe(false);
      expect(
        collectionCalls.some(
          (call) =>
            call.args.database === "l8db_browser_second" &&
            call.args.schema === "l8db_browser_second",
        ),
      ).toBe(true);
      await page.getByRole("combobox", { name: "Datenbank", exact: true }).click();
      await page.getByRole("option", { name: database, exact: true }).click();
      await page.getByText("items", { exact: true }).first().waitFor();
      expect(await page.getByRole("link", { name: "Replikation", exact: true }).count()).toBe(0);
      expect(await page.getByRole("link", { name: "Sitzungen & Locks", exact: true }).count()).toBe(
        0,
      );
      await page.getByRole("link", { name: "Collection erstellen", exact: true }).click();
      const collectionName = `browser_created_${Date.now()}`;
      await page
        .getByRole("textbox", { name: "Collection-Name", exact: true })
        .fill(collectionName);
      await page.getByRole("button", { name: "Collection erstellen", exact: true }).click();
      await page.getByText("Keine Daten.", { exact: true }).waitFor();
      await page.locator(`[data-name="${collectionName}"]`).click({ button: "right" });
      await page.getByRole("menuitem", { name: "Drop Table", exact: true }).click();
      await page
        .getByRole("alertdialog")
        .getByRole("button", { name: "Drop Table", exact: true })
        .click();
      await page.locator(`[data-name="${collectionName}"]`).waitFor({ state: "detached" });
      expect(errors).toEqual([]);
    } catch (error) {
      console.log((await page.locator("body").innerText()).slice(-8000));
      await page.screenshot({ path: "/tmp/l8db-mongo-failure.png" });
      throw error;
    } finally {
      await browser.close();
    }
  },
  90_000,
);
