import { expect, test } from "bun:test";
import { chromium } from "playwright";
import { seedApp } from "./fixtures/perf-app";

test.skipIf(!process.env.L8DB_SPLIT_TRANSACTION_BROWSER_URL)(
  "split view shows an uncommitted SQL insert in the table pane",
  async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.setDefaultTimeout(15000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await seedApp(page, 1, { rows: 0, columns: 2 });
      await page.addInitScript(() => {
        const query = {
          kind: "query",
          id: "split-sql",
          title: "Insert",
          sql: "INSERT INTO public.table_0000 (id) VALUES (999)",
        };
        const table = { kind: "table", schema: "public", table: "table_0000" };
        localStorage.setItem(
          "l8db.table-tabs",
          JSON.stringify({ state: { tabsByConnection: { perf: [query, table] } }, version: 4 }),
        );
        localStorage.setItem(
          "l8db.split-view",
          JSON.stringify({
            state: {
              byConnection: {
                perf: { panes: ["query:split-sql", "table:public.table_0000"], focusedPane: 0 },
              },
            },
            version: 0,
          }),
        );
        const host = window as unknown as {
          __TAURI_INTERNALS__: {
            invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
          };
          splitReads: (string | undefined)[];
          splitCommits: number;
          splitBegins: number;
        };
        const original = host.__TAURI_INTERNALS__.invoke;
        let pending = 0;
        let active = false;
        host.splitReads = [];
        host.splitCommits = 0;
        host.splitBegins = 0;
        host.__TAURI_INTERNALS__.invoke = async (command, args) => {
          if (command === "begin_transaction") {
            active = true;
            host.splitBegins++;
            return "split-tx";
          }
          if (command === "execute_in_transaction") {
            pending++;
            return { columns: [], rows: [], rows_affected: 1, execution_time_ms: 1 };
          }
          if (command === "list_transactions") return active ? ["split-tx"] : [];
          if (command === "commit_transaction") {
            host.splitCommits++;
            active = false;
          }
          if (command === "rollback_transaction") {
            pending = 0;
            active = false;
          }
          if (command === "fetch_table_rows") {
            const txId = args?.txId as string | undefined;
            host.splitReads.push(txId);
            return {
              columns: ["id", "col_1"],
              rows:
                pending && txId === "split-tx"
                  ? Array.from({ length: pending }, (_, index) => ({
                      id: 999 + index,
                      col_1: `pending insert ${index + 1}`,
                      __ctid__: `(0,${index + 1})`,
                    }))
                  : [],
            };
          }
          if (command === "count_table_rows_capped") {
            return {
              count: args?.txId === "split-tx" ? pending : 0,
              exact: true,
              estimate: null,
            };
          }
          return original(command, args);
        };
      });
      await page.goto(`${process.env.L8DB_SPLIT_TRANSACTION_BROWSER_URL}/query/split-sql`);
      const queryPane = page.locator("#split-0");
      const tablePane = page.locator("#split-1");
      await tablePane.getByText("Keine Daten.", { exact: true }).waitFor();
      await queryPane.locator("[data-tour=query-run]").click();
      await tablePane.getByText("pending insert 1", { exact: true }).waitFor();
      await queryPane.locator("[data-tour=query-run]").click();
      await tablePane.getByText("pending insert 2", { exact: true }).waitFor();
      expect(await page.evaluate(() => window.splitReads.includes("split-tx"))).toBe(true);
      expect(await page.evaluate(() => window.splitBegins)).toBe(1);
      expect(await page.evaluate(() => window.splitCommits)).toBe(0);
      await page.getByRole("button", { name: "SQL-Transaktion zurückrollen" }).click();
      await tablePane.getByText("Keine Daten.", { exact: true }).waitFor();
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
  60000,
);
