import { expect, test } from "bun:test";
import { chromium } from "playwright";
import { seedApp } from "./fixtures/perf-app";
import { replaceSql } from "./fixtures/sql-editor";

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
          'SELECT "id" FROM "public"."table_0001" WHERE "id"::text = :master::text LIMIT 25';
        const editor = page.getByRole("dialog").locator(".monaco-editor");
        await replaceSql(page, editor, editedSql);
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
        await link.click();
        await page.getByText("Gespeicherte SQL-Vorlagen", { exact: true }).click();
        await page.getByRole("button", { name: "SQL laden", exact: true }).click();
        await page.getByRole("button", { name: "Speichern & anwenden" }).click();
        await page.getByText("detail-4", { exact: true }).waitFor();
        const restored = await page.evaluate(() =>
          JSON.parse(localStorage.getItem("l8db.master-detail") ?? "{}"),
        );
        expect(Object.values(restored.state.scripts)).toEqual([editedSql]);
        expect(Object.values(restored.state.savedScripts)).toEqual([
          { master: "table_0000", detail: emptyDetail ? "Detail" : "table_0001", sql: editedSql },
        ]);
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

test.skipIf(!process.env.L8DB_MASTER_DETAIL_BROWSER_URL)(
  "single-table master detail rows are editable inside the split view",
  async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1900, height: 950 } });
    page.setDefaultTimeout(10000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await seedApp(page, 2, { rows: 40, columns: 2 });
      await page.addInitScript(() => {
        const tabs = [0, 1].map((index) => ({
          kind: "table",
          schema: "public",
          table: `table_000${index}`,
        }));
        localStorage.setItem(
          "l8db.table-tabs",
          JSON.stringify({ state: { tabsByConnection: { perf: tabs } }, version: 4 }),
        );
        localStorage.setItem(
          "l8db.split-view",
          JSON.stringify({
            state: {
              byConnection: {
                perf: {
                  panes: ["table:public.table_0000", "table:public.table_0001"],
                  focusedPane: 0,
                },
              },
            },
            version: 0,
          }),
        );
        type Row = Record<string, unknown>;
        const host = window as unknown as {
          __TAURI_INTERNALS__: {
            invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
          };
          md: {
            fetches: { filter: string; limit: unknown; txId: unknown }[];
            executes: number;
            updates: { ctid: string; updates: Record<string, unknown> }[];
            deletes: string[];
            commits: number;
          };
        };
        const original = host.__TAURI_INTERNALS__.invoke;
        const items: Row[] = [];
        for (let order = 1; order <= 3; order++)
          for (let line = 0; line < 3; line++)
            items.push({
              __ctid__: `(0,${order * 10 + line})`,
              id: order * 10 + line,
              order_id: order,
              note: `item ${order}-${line}`,
            });
        let committed = items.map((row) => ({ ...row }));
        let working: Row[] | null = null;
        host.md = { fetches: [], executes: 0, updates: [], deletes: [], commits: 0 };
        host.__TAURI_INTERNALS__.invoke = async (command, args) => {
          if (command === "execute_query_with_params") host.md.executes++;
          if (command === "begin_transaction") {
            working = committed.map((row) => ({ ...row }));
            return "md-tx";
          }
          if (command === "list_transactions") return working ? ["md-tx"] : [];
          if (command === "update_row_in_transaction") {
            const ctid = String(args?.ctid);
            const updates = args?.updates as Record<string, unknown>;
            host.md.updates.push({ ctid, updates });
            const row = working?.find((entry) => entry.__ctid__ === ctid);
            if (!row) throw new Error("Zeile nicht gefunden");
            Object.assign(row, updates, { __ctid__: `${ctid}*` });
            return `${ctid}*`;
          }
          if (command === "delete_row_in_transaction") {
            host.md.deletes.push(String(args?.ctid));
            working = (working ?? []).filter((row) => row.__ctid__ !== args?.ctid);
            return null;
          }
          if (command === "commit_transaction") {
            host.md.commits++;
            committed = working ?? committed;
            working = null;
            return null;
          }
          if (command === "fetch_table_rows" && args?.table === "table_0001") {
            const filter = String(args.filter ?? "");
            host.md.fetches.push({ filter, limit: args.limit, txId: args.txId });
            const order = Number(filter.match(/"order_id" = '(\d+)'/)?.[1]);
            const source = args.txId === "md-tx" && working ? working : committed;
            return {
              columns: ["id", "order_id", "note"],
              rows: source.filter((row) => row.order_id === order).map((row) => ({ ...row })),
            };
          }
          if (command === "list_table_columns_detailed" && args?.table === "table_0001")
            return ["id", "order_id", "note"].map((name, index) => ({
              name,
              data_type: name === "note" ? "text" : "integer",
              is_nullable: name === "note",
              column_default: null,
              is_primary_key: name === "id",
              ordinal_position: index + 1,
              character_maximum_length: null,
            }));
          return original(command, args);
        };
      });
      await page.goto(`${process.env.L8DB_MASTER_DETAIL_BROWSER_URL}/tables/public/table_0000`);
      const master = page.locator("#split-0");
      const detail = page.locator("#split-1");
      const md = () =>
        page.evaluate(
          () =>
            (
              window as unknown as {
                md: {
                  fetches: { filter: string; limit: unknown; txId: unknown }[];
                  executes: number;
                  updates: { ctid: string; updates: Record<string, unknown> }[];
                  deletes: string[];
                  commits: number;
                };
              }
            ).md,
        );
      await master.locator('tbody tr[data-index="1"] td[data-col="id"]').click();
      await page.getByRole("button", { name: "Master-Detail-SQL bearbeiten" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.locator(".monaco-editor[role=code]").waitFor();
      await replaceSql(
        page,
        dialog.locator(".monaco-editor"),
        'SELECT * FROM "public"."table_0001" WHERE "order_id" = :master.id LIMIT 50',
      );
      await page.getByRole("button", { name: "Speichern & anwenden" }).click();
      await detail.getByText("item 1-1", { exact: true }).waitFor();
      expect((await md()).fetches.at(-1)).toEqual({
        filter: `"order_id" = '1'`,
        limit: 50,
        txId: undefined,
      });
      expect((await md()).executes).toBe(0);

      const cell = (note: string) =>
        detail.locator("tbody tr").filter({ hasText: note }).locator('td[data-col="note"]');
      await cell("item 1-1").dblclick();
      const input = detail.locator("tr[data-ctid] input");
      await input.fill("geändert im Detail");
      await input.press("Enter");
      await input.waitFor({ state: "detached" });
      await detail.getByText("geändert im Detail", { exact: true }).waitFor();
      expect((await md()).updates).toEqual([
        { ctid: "(0,11)", updates: { note: "geändert im Detail" } },
      ]);

      await master.locator('tbody tr[data-index="2"] td[data-col="id"]').click();
      await detail.getByText("item 2-0", { exact: true }).waitFor();
      expect(await detail.getByText("geändert im Detail").count()).toBe(0);
      await master.locator('tbody tr[data-index="1"] td[data-col="id"]').click();
      await detail.getByText("geändert im Detail", { exact: true }).waitFor();
      expect((await md()).fetches.at(-1)).toMatchObject({
        filter: `"order_id" = '1'`,
        txId: "md-tx",
      });

      const readsBeforeEdits = (await md()).fetches.length;
      const timings: number[] = [];
      let current = "geändert im Detail";
      for (let round = 1; round <= 8; round++) {
        const next = round === 8 ? "zweite Änderung" : `Runde ${round}`;
        await cell(current).dblclick();
        await input.fill(next);
        const started = Date.now();
        await input.press("Enter");
        await detail.getByText(next, { exact: true }).waitFor();
        timings.push(Date.now() - started);
        current = next;
      }
      timings.sort((a, b) => a - b);
      const p95 = timings[Math.ceil(timings.length * 0.95) - 1];
      console.log(`master-detail edit save→render ms: median ${timings[4]}, p95 ${p95}`);
      expect(p95).toBeLessThan(1000);
      expect((await md()).fetches.length).toBe(readsBeforeEdits);
      expect((await md()).updates.at(-1)).toEqual({
        ctid: "(0,11)********",
        updates: { note: "zweite Änderung" },
      });

      await cell("item 1-2").click({ button: "right" });
      await page.getByRole("menuitem", { name: "Zeile löschen" }).click();
      await page.getByText("Zeile gelöscht.", { exact: true }).waitFor();
      await detail.getByText("item 1-2", { exact: true }).waitFor({ state: "detached" });
      expect((await md()).deletes).toEqual(["(0,12)"]);
      expect((await md()).fetches.length).toBe(readsBeforeEdits);
      await page.locator("[data-tx-commit]").click();
      await page.waitForFunction(
        () =>
          (window as unknown as { md: { fetches: { txId: unknown }[]; commits: number } }).md
            .commits === 1 &&
          (window as unknown as { md: { fetches: { txId: unknown }[] } }).md.fetches.at(-1)
            ?.txId === undefined,
      );
      await detail.getByText("zweite Änderung", { exact: true }).waitFor();
      expect(await detail.getByText("item 1-2", { exact: true }).count()).toBe(0);
      await detail.getByText("item 1-0", { exact: true }).waitFor();
      await page.screenshot({ path: "/tmp/l8db-master-detail-edit.png" });
      expect(errors).toEqual([]);
    } catch (error) {
      console.error(errors);
      await page.screenshot({ path: "/tmp/l8db-master-detail-edit-failure.png" });
      throw error;
    } finally {
      await browser.close();
    }
  },
  60000,
);
