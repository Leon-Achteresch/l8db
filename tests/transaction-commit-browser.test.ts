import { expect, test } from "bun:test";
import { chromium } from "playwright";
import { seedApp } from "./fixtures/perf-app";

const URL = process.env.L8DB_TABLE_BROWSER_URL;

test.skipIf(!URL)(
  "keyboard edit opens the transaction panel and Ctrl+Enter commits it from the grid",
  async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.setDefaultTimeout(15000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await seedApp(page, 1, { rows: 2000, columns: 6 });
      await page.addInitScript(() => {
        const host = window as unknown as {
          __TAURI_INTERNALS__: {
            invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
          };
          tx: { begins: number; updates: number; commits: number; open: boolean; reads: number };
        };
        const original = host.__TAURI_INTERNALS__.invoke;
        host.tx = { begins: 0, updates: 0, commits: 0, open: false, reads: 0 };
        host.__TAURI_INTERNALS__.invoke = async (command, args) => {
          if (command === "begin_transaction") {
            host.tx.begins++;
            host.tx.open = true;
            return `kb-tx-${host.tx.begins}`;
          }
          if (command === "fetch_table_rows" && !args?.txId) host.tx.reads++;
          if (command === "update_row_in_transaction") {
            host.tx.updates++;
            return null;
          }
          if (command === "list_transactions")
            return host.tx.open ? [`kb-tx-${host.tx.begins}`] : [];
          if (command === "commit_transaction") {
            host.tx.commits++;
            host.tx.open = false;
            return null;
          }
          return original(command, args);
        };
        localStorage.setItem(
          "l8db.table-tabs",
          JSON.stringify({
            state: {
              tabsByConnection: {
                perf: [{ kind: "table", schema: "public", table: "table_0000" }],
              },
            },
            version: 4,
          }),
        );
      });
      const state = () =>
        page.evaluate(
          () =>
            (window as unknown as { tx: { begins: number; updates: number; commits: number } }).tx,
        );
      await page.goto(`${URL}/tables/public/table_0000`);
      const cell = page.locator('tbody tr[data-index="1"] td[data-col="col_1"]');
      await cell.click();
      const panel = page.locator("[data-tour='tx-panel']");
      const commit = page.locator("[data-tx-commit]");

      const timings: number[] = [];
      for (let round = 1; round <= 5; round++) {
        await page.keyboard.press("Enter");
        const input = page.locator("tbody input").first();
        await input.waitFor();
        await input.fill(`runde ${round}`);
        await page.keyboard.press("Enter");
        await input.waitFor({ state: "detached" });
        await panel.waitFor();
        await commit.waitFor();
        if (round === 1) {
          await panel.screenshot({ path: "/tmp/l8db-transaction-commit-panel.png" });
          expect(await commit.locator("kbd").textContent()).toMatch(/^(⌘↵|Ctrl\+?Enter|Ctrl\+?↵)$/);
        }
        expect(
          await page.evaluate(() => !!document.activeElement?.closest("[data-grid-scroll]")),
        ).toBe(true);
        const reads = await page.evaluate(
          () => (window as unknown as { tx: { reads: number } }).tx.reads,
        );
        const started = performance.now();
        await page.keyboard.press("Control+Enter");
        await page.waitForFunction(
          (n) => (window as unknown as { tx: { commits: number } }).tx.commits === n,
          round,
        );
        await commit.waitFor({ state: "detached" });
        timings.push(performance.now() - started);
        expect(await page.locator("tbody input").count()).toBe(0);
        await page.waitForFunction(
          (n) => (window as unknown as { tx: { reads: number } }).tx.reads > n,
          reads,
        );
        await page.waitForTimeout(300);
        expect(
          await page.evaluate(() => (window as unknown as { tx: { reads: number } }).tx.reads),
        ).toBeLessThanOrEqual(reads + 2);
        expect(
          await page.evaluate(() => !!document.activeElement?.closest("[data-grid-scroll]")),
        ).toBe(true);
      }
      expect(await state()).toMatchObject({ begins: 5, updates: 5, commits: 5 });

      await page.keyboard.press("Enter");
      await page.locator("tbody input").first().fill("im panel");
      await page.keyboard.press("Enter");
      await commit.waitFor();
      await commit.focus();
      await page.keyboard.press("Meta+Enter");
      await page.waitForFunction(
        () => (window as unknown as { tx: { commits: number } }).tx.commits === 6,
      );

      timings.sort((a, b) => a - b);
      const p95 = timings[Math.ceil(timings.length * 0.95) - 1];
      console.log(
        `tx Ctrl+Enter commit→panel closed ms: median ${timings[2].toFixed(0)}, p95 ${p95.toFixed(0)}`,
      );
      expect(p95).toBeLessThan(1500);
      expect(errors).toEqual([]);
    } catch (error) {
      await page.screenshot({ path: "/tmp/l8db-transaction-commit-failure.png" });
      throw error;
    } finally {
      await browser.close();
    }
  },
  90000,
);
