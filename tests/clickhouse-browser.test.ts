import { expect, test } from "bun:test";
import { chromium, webkit } from "playwright";

const bridge = process.env.L8DB_CLICKHOUSE_BRIDGE ?? "http://127.0.0.1:27021";
const connectionString =
  process.env.L8DB_CLICKHOUSE_BROWSER_URL ?? "clickhouse://l8db@127.0.0.1:8124/bigdata";

test.skipIf(!process.env.L8DB_CLICKHOUSE_BROWSER)(
  "ClickHouse: real adapter, wide types, editor and quoted identifiers",
  async () => {
    const browser = await (process.env.L8DB_CLICKHOUSE_WEBKIT ? webkit : chromium).launch({
      headless: true,
    });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const errors: string[] = [];
    page.on("pageerror", (error) => {
      if (error.message !== "ResizeObserver loop completed with undelivered notifications.")
        errors.push(error.message);
    });
    await page.addInitScript(
      ({ bridge, connectionString }) => {
        localStorage.setItem(
          "l8db.settings",
          JSON.stringify({ state: { tourFinished: true, onboardingDone: true }, version: 0 }),
        );
        localStorage.setItem(
          "l8db.connections",
          JSON.stringify({
            state: {
              connections: [
                {
                  id: "clickhouse-lab",
                  name: "ClickHouse Docker Lab",
                  kind: "clickhouse",
                  connectionString,
                  sslMode: "disable",
                  ssh: null,
                },
              ],
              activeId: "clickhouse-lab",
            },
            version: 0,
          }),
        );
        const host = window as unknown as {
          __TAURI_INTERNALS__: unknown;
          __TAURI_EVENT_PLUGIN_INTERNALS__: unknown;
          clickhouseCalls: { command: string; args: Record<string, unknown> }[];
        };
        host.clickhouseCalls = [];
        host.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
        host.__TAURI_INTERNALS__ = {
          transformCallback: () => 1,
          unregisterCallback: () => {},
          metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
          invoke: async (command: string, args: Record<string, unknown> = {}) => {
            if (command.endsWith("secret")) return command === "load_secret" ? "l8db" : null;
            if (
              command.startsWith("plugin:") ||
              command.includes("extension") ||
              command === "list_ssh_tunnels"
            )
              return [];
            host.clickhouseCalls.push({ command, args });
            const response = await fetch(bridge, {
              method: "POST",
              body: JSON.stringify({ command, args }),
            });
            const value = await response.json();
            if (value.error) throw Error(value.error);
            return value.result;
          },
        };
      },
      { bridge, connectionString },
    );
    try {
      await page.goto("http://localhost:1420");
      await page.getByRole("combobox", { name: "Datenbank", exact: true }).waitFor();
      const sidebarTable = (name: string) => page.locator(`a[data-schema][data-name="${name}"]`);
      await sidebarTable("events_big").waitFor();
      expect(await sidebarTable("kv_memory").count()).toBe(1);

      await sidebarTable("events_big").click();
      await page.getByText("1–100 von 20000000", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Filter", exact: true }).click();
      await page.getByRole("tab", { name: "SQL", exact: true }).click();
      await page.locator(".cm-editor .cm-content").click();
      await page.keyboard.press("ControlOrMeta+a");
      await page.keyboard.insertText("kind = 'purchase' AND id = 2");
      await page.getByRole("button", { name: "Filter anwenden", exact: true }).click();
      await page.getByText("1–1 von 1", { exact: true }).waitFor();
      await page.screenshot({ path: "/tmp/l8db-clickhouse-table.png" });

      await sidebarTable("kv_memory").click({ button: "right" });
      await page.getByRole("menuitem", { name: /^Neue Abfrage für / }).click();
      await page.getByRole("button", { name: "Statement ausführen", exact: true }).click();
      await page.getByText("100 Zeilen", { exact: true }).first().waitFor();
      await page.locator(".monaco-editor .view-lines").first().click();
      await page.keyboard.press("ControlOrMeta+a");
      await page.keyboard.insertText(
        "SELECT big, huge, code FROM bigdata.events_big WHERE kind = 'click' AND id = 7",
      );
      await page.getByRole("button", { name: "Statement ausführen", exact: true }).click();
      await page.getByText("7000000000000000000070", { exact: true }).first().waitFor();
      await page.getByText("-7000000000000", { exact: true }).first().waitFor();
      await page.screenshot({ path: "/tmp/l8db-clickhouse-query.png" });

      await page.getByRole("combobox", { name: "Datenbank", exact: true }).click();
      await page.getByRole("option", { name: "weird db", exact: true }).click();
      await sidebarTable("my table").click();
      await page.locator('th[data-column-id="spaced col"]').waitFor();
      await page.locator('th[data-column-id="ümläut"]').waitFor();
      await page.getByText("v1", { exact: true }).first().waitFor();
      const rowCalls = await page.evaluate(() =>
        (
          window as unknown as {
            clickhouseCalls: { command: string; args: Record<string, unknown> }[];
          }
        ).clickhouseCalls.filter((call) => call.command === "fetch_table_rows"),
      );
      expect(
        rowCalls.some((call) => call.args.schema === "weird db" && call.args.table === "my table"),
      ).toBe(true);
      expect(errors).toEqual([]);
    } catch (error) {
      await page.screenshot({ path: "/tmp/l8db-clickhouse-browser-failure.png" });
      throw error;
    } finally {
      await browser.close();
    }
  },
  120_000,
);
