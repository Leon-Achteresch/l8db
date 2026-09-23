import { expect, test } from "bun:test";
import { chromium } from "playwright";
import { saveBrowserArtifacts } from "./fixtures/browser-artifacts";
import { seedApp } from "./fixtures/perf-app";

test.skipIf(!process.env.L8DB_TABLE_BROWSER_URL)(
  "retired data workspaces stay stored and are hidden from the definition comparison",
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
      expect(await page.getByLabel("Vergleichsmodus").count()).toBe(0);
      await page.getByRole("button", { name: "Arbeitsstände", exact: true }).click();
      await page.getByText("Noch keine Arbeitsstände gespeichert.").waitFor();
      expect(await page.getByText("Custom data", { exact: true }).count()).toBe(0);
      expect(await page.evaluate(() => localStorage.getItem("l8db.analysis-workspaces"))).toContain(
        "Custom data",
      );
      expect(
        await page.evaluate(() =>
          (window as unknown as { compareCalls: string[] }).compareCalls.includes(
            "compare_table_data",
          ),
        ),
      ).toBe(false);
      expect(errors).toEqual([]);
    } finally {
      await saveBrowserArtifacts(browser, "data-compare");
      await browser.close();
    }
  },
  60000,
);
