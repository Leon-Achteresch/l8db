import { expect, test } from "bun:test";
import { chromium } from "playwright";
import { seedApp } from "./fixtures/perf-app";

const URL = process.env.L8DB_TABLE_BROWSER_URL;

type Probe = { updates: Record<string, unknown>[]; invokes: string[] };

test.skipIf(!URL)(
  "date and timestamp cells offer now() helpers and resolve typed shortcuts",
  async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 2200, height: 900 } });
    page.setDefaultTimeout(15000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await seedApp(page, 1, { rows: 20, columns: 4 });
      await page.addInitScript(() => {
        const host = window as unknown as {
          __TAURI_INTERNALS__: {
            invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
          };
          probe: Probe;
        };
        const original = host.__TAURI_INTERNALS__.invoke;
        const types: Record<string, string> = {
          id: "integer",
          created_at: "timestamp with time zone",
          due: "date",
          starts: "time without time zone",
          note: "text",
        };
        const rows = Array.from({ length: 5000 }, (_, i) => ({
          __ctid__: `(0,${i + 1})`,
          id: i + 1,
          created_at: "2020-01-01 10:00:00+00",
          due: "2020-01-01",
          starts: "08:00:00",
          note: `n${i}`,
        }));
        let open = false;
        host.probe = { updates: [], invokes: [] };
        host.__TAURI_INTERNALS__.invoke = async (command, args) => {
          host.probe.invokes.push(command);
          if (command === "begin_transaction") {
            open = true;
            return "tmp-tx";
          }
          if (command === "list_transactions") return open ? ["tmp-tx"] : [];
          if (command === "update_row" || command === "update_row_in_transaction") {
            host.probe.updates.push(args?.updates as Record<string, unknown>);
            return command === "update_row" ? null : args?.ctid;
          }
          if (command === "list_table_columns_detailed")
            return Object.entries(types).map(([name, data_type], index) => ({
              name,
              data_type,
              is_nullable: name !== "id",
              column_default: null,
              is_primary_key: name === "id",
              ordinal_position: index + 1,
              character_maximum_length: null,
            }));
          if (command === "fetch_table_rows") {
            const offset = Number(args?.offset ?? 0);
            const limit = Number(args?.limit ?? 100);
            return {
              columns: Object.keys(types),
              rows: rows.slice(offset, offset + limit).map((row) => ({ ...row })),
            };
          }
          if (command === "count_table_rows") return rows.length;
          if (command === "count_table_rows_capped")
            return { count: rows.length, exact: true, estimate: null };
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
      const probe = () => page.evaluate(() => (window as unknown as { probe: Probe }).probe);
      const lastUpdate = async (count: number) => {
        await page.waitForFunction(
          (n) => (window as unknown as { probe: Probe }).probe.updates.length >= n,
          count,
        );
        return (await probe()).updates[count - 1];
      };
      const cell = (row: number, col: string) =>
        page.locator(`tbody tr[data-index="${row}"] td[data-col="${col}"]`);
      const input = page.locator("tbody input").first();
      const helper = (label: string) => page.getByRole("button", { name: label, exact: true });
      const openEditor = async (row: number, col: string) => {
        await cell(row, col).dispatchEvent("dblclick");
        await input.waitFor();
      };

      await page.goto(`${URL}/tables/public/table_0000`);
      await cell(0, "created_at").waitFor();

      await openEditor(0, "created_at");
      expect(
        await helper("Jetzt").locator("xpath=..").getByRole("button").allTextContents(),
      ).toEqual(["Jetzt", "Heute", "Gestern", "Morgen", "Monatsanfang"]);
      await page
        .locator("tbody tr:has(input)")
        .screenshot({ path: "/tmp/l8db-temporal-cell-helpers.png" });
      await helper("Jetzt").click();
      expect(await input.evaluate((el) => el === document.activeElement)).toBe(true);
      const nowText = await input.inputValue();
      expect(nowText).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3} [+-]\d\d:\d\d$/);
      expect(
        Math.abs(Date.parse(nowText.replace(" ", "T").replace(" ", "")) - Date.now()),
      ).toBeLessThan(60_000);
      await page.keyboard.press("Enter");
      expect(await lastUpdate(1)).toMatchObject({ created_at: nowText });

      const today = await page.evaluate(() => {
        const d = new Date();
        const pad = (n: number) => String(n).padStart(2, "0");
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      });

      await openEditor(1, "due");
      await input.fill("current_date");
      await page.keyboard.press("Enter");
      expect(await lastUpdate(2)).toMatchObject({ due: today });

      await openEditor(2, "due");
      await helper("Gestern").click();
      await page.keyboard.press("Enter");
      const yesterday = (await lastUpdate(3)).due as string;
      expect(Date.parse(today) - Date.parse(yesterday)).toBe(86_400_000);

      await openEditor(3, "created_at");
      await input.fill("NOW()");
      await page.keyboard.press("Enter");
      expect(String((await lastUpdate(4)).created_at)).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d/);

      await openEditor(4, "starts");
      expect(await helper("Heute").count()).toBe(0);
      await helper("Jetzt").click();
      await page.keyboard.press("Enter");
      expect(String((await lastUpdate(5)).starts)).toMatch(/^\d\d:\d\d:\d\d$/);

      await openEditor(5, "note");
      expect(await helper("Jetzt").count()).toBe(0);
      await input.fill("now()");
      await page.keyboard.press("Enter");
      expect(await lastUpdate(6)).toMatchObject({ note: "now()" });

      const timings: number[] = [];
      const invokesBefore = (await probe()).invokes.length;
      for (let round = 0; round < 15; round++) {
        await cell(6 + round, "created_at").click();
        const started = performance.now();
        await page.keyboard.press("Enter");
        await helper("Monatsanfang").waitFor();
        timings.push(performance.now() - started);
        expect(await page.locator("tbody td:has(input) button").count()).toBe(5);
        await page.keyboard.press("Escape");
        await input.waitFor({ state: "detached" });
      }
      const invokes = (await probe()).invokes
        .slice(invokesBefore)
        .filter((command) => /row|table|column|query|transaction|count/.test(command));
      timings.sort((a, b) => a - b);
      const median = timings[Math.floor(timings.length / 2)];
      const p95 = timings[Math.ceil(timings.length * 0.95) - 1];
      console.log(
        `temporal editor open ms (15 rounds, 5000-row table): median ${median.toFixed(0)}, p95 ${p95.toFixed(0)}, invokes ${invokes.join(",") || "none"}`,
      );
      expect(invokes.length).toBe(0);
      expect(p95).toBeLessThan(500);
      expect(errors).toEqual([]);
    } catch (error) {
      await page.screenshot({ path: "/tmp/l8db-temporal-cell-helpers-failure.png" });
      throw error;
    } finally {
      await browser.close();
    }
  },
  90000,
);
