import { expect, test } from "bun:test";
import { chromium } from "playwright";
import { seedApp } from "./fixtures/perf-app";

for (const emptyDetail of [false, true]) {
  test.skipIf(!process.env.L8DB_MASTER_DETAIL_BROWSER_URL)(
    `master detail follows selection and restores its SQL (empty detail: ${emptyDetail})`,
    async () => {
      const browser = await chromium.launch();
      const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
      page.setDefaultTimeout(10000);
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      try {
        await seedApp(page, 2);
        await page.addInitScript((empty: boolean) => {
          const tabs = [0, 1].map((index) => ({
            kind: "table",
            schema: "public",
            table: `table_000${index}`,
          }));
          localStorage.setItem(
            "l8db.table-tabs",
            JSON.stringify({
              state: { tabsByConnection: { perf: empty ? tabs.slice(0, 1) : tabs } },
              version: 4,
            }),
          );
          localStorage.setItem(
            "l8db.split-view",
            JSON.stringify({
              state: {
                byConnection: {
                  perf: {
                    panes: ["table:public.table_0000", empty ? null : "table:public.table_0001"],
                    focusedPane: 0,
                  },
                },
              },
              version: 0,
            }),
          );
          const host = window as unknown as {
            __TAURI_INTERNALS__: {
              invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
            };
            masterCalls: Record<string, unknown>[];
          };
          const original = host.__TAURI_INTERNALS__.invoke;
          host.masterCalls = [];
          host.__TAURI_INTERNALS__.invoke = async (command, args) => {
            if (command === "execute_query_with_params") {
              host.masterCalls.push(args ?? {});
              const params = args?.params as string[];
              if (params[0] === "2") await new Promise((resolve) => setTimeout(resolve, 600));
              return {
                columns: ["matched"],
                rows: [{ matched: `detail-${params[0]}` }],
                rows_affected: null,
                execution_time_ms: 1,
              };
            }
            return original(command, args);
          };
        }, emptyDetail);
        await page.goto(`${process.env.L8DB_MASTER_DETAIL_BROWSER_URL}/tables/public/table_0000`);
        const master = page.locator("#split-0");
        await master.locator('tbody tr[data-index="1"] td[data-col="id"]').click();
        const link = page.getByRole("button", { name: "Master-Detail-SQL bearbeiten" });
        await link.click();
        await page.getByRole("dialog").waitFor();
        await page.getByRole("dialog").locator(".monaco-editor[role=code]").waitFor();
        const editedSql =
          'SELECT * FROM "public"."table_0001" WHERE "id"::text = :master::text LIMIT 25';
        const editor = page.getByRole("dialog").locator(".monaco-editor .view-lines");
        await editor.click({ position: { x: 30, y: 10 } });
        await page.keyboard.press("ControlOrMeta+a");
        await page.keyboard.type(editedSql);
        await page.screenshot({ path: "/tmp/l8db-master-detail-editor.png" });
        await page.getByRole("button", { name: "Speichern & anwenden" }).click();
        await page.getByText("detail-1", { exact: true }).waitFor();
        await master.locator('tbody tr[data-index="2"] td[data-col="id"]').click();
        await page.waitForFunction(() =>
          (window as unknown as { masterCalls: { params: string[] }[] }).masterCalls.some(
            (call) => call.params[0] === "2",
          ),
        );
        await master.locator('tbody tr[data-index="3"] td[data-col="id"]').click();
        await page.getByText("detail-3", { exact: true }).waitFor();
        await page.waitForTimeout(650);
        expect(await page.getByText("detail-2", { exact: true }).count()).toBe(0);
        await page.screenshot({ path: "/tmp/l8db-master-detail-result.png" });
        const saved = await page.evaluate(() => localStorage.getItem("l8db.master-detail"));
        expect(Object.values(JSON.parse(saved ?? "{}").state.scripts)).toEqual([editedSql]);
        await page.reload();
        await page.getByText("Wähle eine Zelle im Master, um die Details zu laden.").waitFor();
        await master.locator('tbody tr[data-index="4"] td[data-col="id"]').click();
        await page.getByText("detail-4", { exact: true }).waitFor();
        await link.click();
        await page.getByRole("button", { name: "Verknüpfung entfernen" }).click();
        expect(
          await page.evaluate(
            () =>
              Object.keys(
                JSON.parse(localStorage.getItem("l8db.master-detail") ?? "{}").state.scripts,
              ).length,
          ),
        ).toBe(0);
        expect(errors).toEqual([]);
      } catch (error) {
        console.error(errors);
        await page.screenshot({ path: "/tmp/l8db-master-detail-failure.png" });
        throw error;
      } finally {
        await browser.close();
      }
    },
    60000,
  );
}
