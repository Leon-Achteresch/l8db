import { expect, test } from "bun:test";
import { chromium } from "playwright";
import { saveBrowserArtifacts } from "./fixtures/browser-artifacts";
import { seedApp } from "./fixtures/perf-app";

test.skipIf(!process.env.L8DB_TABLE_BROWSER_URL)(
  "data comparison restores custom keys and opens scripts on the selected target",
  async () => {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      page.setDefaultTimeout(10000);
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await seedApp(page, 2, { rows: 2, columns: 2 });
      await page.addInitScript(() => {
        Object.assign(window, {
          __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => {} },
        });
        const stored = JSON.parse(localStorage.getItem("l8db.connections") ?? "null");
        stored.state.connections.push({
          ...stored.state.connections[0],
          id: "target",
          name: "Target",
          connectionString: "postgresql://leon@localhost:5432/target_db",
        });
        localStorage.setItem("l8db.connections", JSON.stringify(stored));
        localStorage.setItem(
          "l8db.analysis-workspaces",
          JSON.stringify({
            state: {
              workspaces: [
                {
                  id: "saved",
                  name: "Custom data",
                  tab: "data",
                  left: {},
                  right: {},
                  dataLeft: {
                    connectionId: "perf",
                    database: "l8db_perf",
                    schema: "public",
                    table: "table_0000",
                    keyColumns: ["id"],
                  },
                  dataRight: {
                    connectionId: "target",
                    database: "target_db",
                    schema: "public",
                    table: "table_0000",
                    keyColumns: ["id"],
                  },
                },
              ],
            },
            version: 0,
          }),
        );
        const host = window as unknown as {
          __TAURI_INTERNALS__: {
            invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
          };
          compareCalls: string[];
        };
        const invoke = host.__TAURI_INTERNALS__.invoke;
        host.compareCalls = [];
        host.__TAURI_INTERNALS__.invoke = async (command, args) => {
          host.compareCalls.push(command);
          if (command === "list_table_columns_detailed")
            return [
              { name: "id", data_type: "integer", is_primary_key: false },
              { name: "col_1", data_type: "text", is_primary_key: false },
            ];
          if (command === "compare_table_data")
            return {
              counts: { equal: 99999, changed: 1, only_left: 0, only_right: 0 },
              detailsTruncated: false,
              rows: [
                {
                  keyText: "one",
                  keyValues: { id: 1 },
                  category: "changed",
                  left: { id: 1, col_1: "new" },
                  right: { id: 1, col_1: "old" },
                  differences: [{ column: "col_1", left: "new", right: "old" }],
                },
              ],
            };
          return invoke(command, args);
        };
      });
      await page.goto(`${process.env.L8DB_TABLE_BROWSER_URL}/compare`);
      await page.getByLabel("Analyse-Arbeitsstand").selectOption("saved");
      await page.getByRole("button", { name: "Laden", exact: true }).click();
      expect(await page.getByLabel("Vergleichsmodus").inputValue()).toBe("data");
      await page.waitForFunction(() =>
        localStorage.getItem("l8db.table-tabs")?.includes('"dataLeft"'),
      );
      await page.reload();
      expect(await page.getByLabel("Vergleichsmodus").inputValue()).toBe("data");
      await page.getByRole("button", { name: "Vergleichen", exact: true }).click();
      await page.getByRole("button", { name: "Als Query-Tab", exact: true }).click();
      await page.waitForURL(/\/query\//);
      expect(
        await page.evaluate(
          () => JSON.parse(localStorage.getItem("l8db.connections") ?? "null").state.activeId,
        ),
      ).toBe("target");
      expect(
        await page.evaluate(
          () =>
            JSON.parse(localStorage.getItem("l8db.db-selection") ?? "null").state
              .databaseByConnection.target,
        ),
      ).toBe("target_db");
      expect(
        await page.evaluate(() =>
          (window as unknown as { compareCalls: string[] }).compareCalls.includes("execute_query"),
        ),
      ).toBe(false);
      await page.goto(`${process.env.L8DB_TABLE_BROWSER_URL}/compare`);
      await page.getByLabel("Analyse-Arbeitsstand").selectOption("saved");
      await page.getByRole("button", { name: "Laden", exact: true }).click();
      await page.getByRole("button", { name: "Vergleichen", exact: true }).click();
      await page.getByRole("combobox").filter({ hasText: "Links nach rechts" }).click();
      await page.getByRole("option", { name: "Rechts nach links" }).click();
      await page.getByRole("button", { name: "Als Query-Tab", exact: true }).click();
      await page.waitForURL(/\/query\//);
      expect(
        await page.evaluate(
          () => JSON.parse(localStorage.getItem("l8db.connections") ?? "null").state.activeId,
        ),
      ).toBe("perf");
      expect(
        await page.evaluate(
          () =>
            JSON.parse(localStorage.getItem("l8db.db-selection") ?? "null").state
              .databaseByConnection.perf,
        ),
      ).toBe("l8db_perf");
      expect(
        await page.evaluate(() =>
          (window as unknown as { compareCalls: string[] }).compareCalls.includes("execute_query"),
        ),
      ).toBe(false);
    } finally {
      await saveBrowserArtifacts(browser, "data-compare");
      await browser.close();
    }
  },
  60000,
);
