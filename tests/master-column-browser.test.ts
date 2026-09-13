import { expect, test } from "bun:test";
import { chromium } from "playwright";
import { seedApp } from "./fixtures/perf-app";

test.skipIf(!process.env.L8DB_MASTER_DETAIL_BROWSER_URL)("SQL modal binds :master.id across cell changes", async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await seedApp(page, 2);
    await page.addInitScript(() => {
      localStorage.setItem("l8db.table-tabs", JSON.stringify({ state: { tabsByConnection: { perf: [{ kind: "table", schema: "public", table: "table_0000" }] } }, version: 4 }));
      localStorage.setItem("l8db.split-view", JSON.stringify({ state: { byConnection: { perf: { panes: ["table:public.table_0000", null], focusedPane: 0 } } }, version: 0 }));
      const host = window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> } };
      const original = host.__TAURI_INTERNALS__.invoke;
      host.__TAURI_INTERNALS__.invoke = async (command, args) => {
        if (command === "list_foreign_keys") return [
          { constraint_name: "customer_fk", from_schema: "public", from_table: "table_0000", from_column: "id", to_schema: "public", to_table: "customers", to_column: "customer_id" },
          { constraint_name: "items_fk", from_schema: "public", from_table: "items", from_column: "order_id", to_schema: "public", to_table: "table_0000", to_column: "id" },
        ];
        if (command === "execute_query_with_params") return { columns: ["matched"], rows: [{ matched: `detail-${(args?.params as string[])[0]}` }], rows_affected: null, execution_time_ms: 1 };
        return original(command, args);
      };
    });
    await page.goto(`${process.env.L8DB_MASTER_DETAIL_BROWSER_URL}/tables/public/table_0000`);
    const master = page.locator("#split-0");
    await master.locator('tbody tr[data-index="1"] td[data-col="id"]').click();
    await page.getByRole("button", { name: "Master-Detail-SQL bearbeiten" }).click();
    const dialog = page.getByRole("dialog");
    expect(await dialog.getByRole("button", { name: "Beziehungen", exact: true }).count()).toBe(0);
    expect(await dialog.getByLabel("Master-Spalte").count()).toBe(0);
    await dialog.getByRole("button", { name: "Beziehungs-SQL laden" }).click();
    await dialog.getByRole("button", { name: "Speichern & anwenden" }).click();
    await page.getByText("detail-1", { exact: true }).waitFor();
    await master.locator('tbody tr[data-index="2"] td[data-col="col_1"]').click();
    await page.getByText("detail-2", { exact: true }).waitFor();
    await page.reload();
    await master.locator('tbody tr[data-index="3"] td[data-col="col_2"]').click();
    await page.getByText("detail-3", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Master-Detail-SQL bearbeiten" }).click();
    expect(await dialog.getByLabel("Master-Spalte").count()).toBe(0);
    await dialog.locator(".monaco-editor[role=code]").waitFor();
    await page.waitForTimeout(250);
    await page.screenshot({ path: "/tmp/l8db-master-column-sql.png" });
    const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem("l8db.master-detail") ?? "{}"));
    expect(Object.values(persisted.state.scripts)[0]).toContain(":master.id");
    expect(Object.values(persisted.state.scripts)[0]).toContain('FROM "public"."customers"');
    expect(await dialog.getByLabel("FK-/PK-Beziehung").locator("option").count()).toBe(2);
    const child = await dialog.getByLabel("FK-/PK-Beziehung").locator("option").nth(1).getAttribute("value");
    await dialog.getByLabel("FK-/PK-Beziehung").selectOption(child!);
    await dialog.getByRole("button", { name: "Beziehungs-SQL laden" }).click();
    await dialog.getByRole("button", { name: "Speichern & anwenden" }).click();
    await page.getByText("detail-3", { exact: true }).waitFor();
    const childSql = await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem("l8db.master-detail") ?? "{}").state.scripts)[0]);
    expect(childSql).toContain('FROM "public"."items"');
    expect(childSql).toContain('"order_id" = :master.id');
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
  }
}, 60000);
