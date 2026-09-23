import { expect, test } from "bun:test";
import { chromium, webkit } from "playwright";
import { seedApp } from "./fixtures/perf-app";
import { replaceSql } from "./fixtures/sql-editor";

const bridge = process.env.L8DB_MD_BROWSER_URL;
const app = process.env.L8DB_MASTER_DETAIL_BROWSER_URL ?? "http://localhost:1420";

for (const kind of ["postgres", "oracle"] as const) {
  for (const engine of ["chromium", "webkit"] as const) {
    test.skipIf(!bridge)(
      `${engine}: ${kind} live master-detail SQL from relation to preview and row updates`,
      async () => {
        const browser = await (engine === "chromium" ? chromium : webkit).launch();
        const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
        page.setDefaultTimeout(15000);
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        const calls: { sql: string; params: (string | null)[] }[] = [];
        const schema = kind === "oracle" ? "L8DB_MD_LAB" : "public";
        try {
          let health: { providers: unknown[] } | undefined;
          for (let attempt = 0; attempt < 45; attempt += 1) {
            try {
              health = await fetch(`${bridge}/health`).then((response) => response.json());
              break;
            } catch {
              await new Promise((resolve) => setTimeout(resolve, 1000));
            }
          }
          if (!health) throw new Error("Master-detail lab bridge did not start");
          await page.exposeFunction(
            "masterDetailLab",
            async (command: string, args: Record<string, unknown>) => {
              if (command === "list_providers") return health.providers;
              if (command === "execute_query_with_params")
                calls.push({ sql: String(args.sql), params: args.params as (string | null)[] });
              const delayMs =
                command === "execute_query_with_params" && (args.params as string[])?.[0] === "102"
                  ? 400
                  : 0;
              const data = await fetch(bridge!, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ kind, command, args, delayMs }),
              }).then((response) => response.json());
              if (data.error) throw new Error(data.error);
              return data.result;
            },
          );
          await seedApp(page, 1);
          await page.addInitScript(
            ({ kind, schema }) => {
              const connections = JSON.parse(localStorage.getItem("l8db.connections") ?? "{}");
              connections.state.connections[0].kind = kind;
              connections.state.connections[0].name =
                kind === "oracle" ? "Oracle · Test" : "PostgreSQL · Test";
              connections.state.connections[0].connectionString =
                kind === "oracle"
                  ? "oracle://lab@localhost/FREEPDB1"
                  : "postgresql://lab@localhost/masterdetail";
              localStorage.setItem("l8db.connections", JSON.stringify(connections));
              localStorage.setItem(
                "l8db.table-tabs",
                JSON.stringify({
                  state: {
                    tabsByConnection: { perf: [{ kind: "table", schema, table: "MD_ORDERS" }] },
                  },
                  version: 4,
                }),
              );
              localStorage.setItem(
                "l8db.split-view",
                JSON.stringify({
                  state: {
                    byConnection: {
                      perf: { panes: [`table:${schema}.MD_ORDERS`, null], focusedPane: 0 },
                    },
                  },
                  version: 0,
                }),
              );
              const host = window as unknown as {
                __TAURI_INTERNALS__: {
                  invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
                };
                masterDetailLab: (
                  command: string,
                  args: Record<string, unknown>,
                ) => Promise<unknown>;
              };
              const original = host.__TAURI_INTERNALS__.invoke;
              host.__TAURI_INTERNALS__.invoke = async (command, args) => {
                if (
                  [
                    "list_providers",
                    "list_foreign_keys",
                    "list_table_columns_detailed",
                    "fetch_table_rows",
                    "count_table_rows",
                    "count_table_rows_capped",
                    "execute_query_with_params",
                  ].includes(command)
                )
                  return host.masterDetailLab(command, args ?? {});
                if (command === "list_schemas") return [schema];
                if (command === "list_tables")
                  return ["MD_ORDERS", "MD_ITEMS", "MD_CUSTOMERS", "MD_TENANTS"].map((name) => ({
                    schema,
                    name,
                  }));
                if (command === "list_all_columns") return [];
                return original(command, args);
              };
            },
            { kind, schema },
          );
          await page.goto(`${app}/tables/${schema}/MD_ORDERS`);
          const master = page.locator("#split-0");
          const detail = page.locator("#split-1");
          await master.locator('tbody tr[data-index="0"] td[data-col="REF"]').click();
          const link = page.getByRole("button", { name: "Master-Detail-SQL bearbeiten" });
          await link.click();
          const dialog = page.getByRole("dialog");
          const relation = dialog.getByLabel("FK-/PK-Beziehung");
          await dialog.getByRole("button", { name: "Vorschau", exact: true }).click();
          const preview = dialog.getByRole("region", { name: "SQL-Vorschau" });
          await preview.getByText("Schrauben", { exact: true }).waitFor();
          await preview.getByText("Muttern", { exact: true }).waitFor();
          expect(calls.at(-1)?.params).toEqual(["101"]);
          expect(calls.at(-1)?.sql).toContain('"REF_AUF_KOPF" = $1');
          if (kind === "oracle") expect(calls.at(-1)?.sql).toContain("FETCH FIRST 100 ROWS ONLY");
          await dialog.locator(".monaco-editor[role=code]").waitFor();
          await page.screenshot({ path: `/tmp/l8db-master-detail-${kind}-${engine}-preview.png` });
          await dialog.getByRole("button", { name: "Speichern & anwenden" }).click();
          await detail.getByText("Schrauben", { exact: true }).waitFor();
          await master.locator('tbody tr[data-index="1"] td[data-col="LABEL"]').click();
          await detail.getByText("Dichtung", { exact: true }).waitFor();
          expect(await detail.getByText("Schrauben", { exact: true }).count()).toBe(0);
          await master.locator('tbody tr[data-index="2"] td[data-col="LABEL"]').click();
          await detail.getByText("Keine passenden Details für diese Master-Zeile.").waitFor();
          await master.locator('tbody tr[data-index="1"] td[data-col="LABEL"]').click();
          await page.waitForTimeout(160);
          await master.locator('tbody tr[data-index="0"] td[data-col="REF_CUSTOMER"]').click();
          await detail.getByText("Schrauben", { exact: true }).waitFor();
          await page.waitForTimeout(500);
          expect(await detail.getByText("Dichtung", { exact: true }).count()).toBe(0);
          await link.click();
          await relation.click();
          await page.getByRole("option").filter({ hasText: "MD_CUSTOMERS" }).click();
          await dialog.getByRole("button", { name: "Vorschau", exact: true }).click();
          await preview.getByText("O'Reilly", { exact: true }).waitFor();
          await dialog.getByRole("button", { name: "Speichern & anwenden" }).click();
          await detail.getByText("O'Reilly", { exact: true }).waitFor();
          await master.locator('tbody tr[data-index="2"] td[data-col="LABEL"]').click();
          await detail.getByText("Keine passenden Details für diese Master-Zeile.").waitFor();
          expect(calls.at(-1)?.params).toEqual([null]);
          await master.locator('tbody tr[data-index="1"] td[data-col="REF_TENANT"]').click();
          await link.click();
          await relation.click();
          await page.getByRole("option").filter({ hasText: "MD_TENANTS" }).click();
          await dialog.getByRole("button", { name: "Vorschau", exact: true }).click();
          await preview.getByText("Tenant B", { exact: true }).waitFor();
          expect(calls.at(-1)?.params).toEqual(["B", "1"]);
          await dialog.getByRole("button", { name: "Speichern & anwenden" }).click();
          await page.reload();
          await master.locator('tbody tr[data-index="0"] td[data-col="LABEL"]').click();
          await detail.getByText("Tenant A", { exact: true }).waitFor();
          await link.click();
          const editor = dialog.locator(".monaco-editor");
          const beforeInvalid = calls.length;
          await replaceSql(
            page,
            editor,
            `SELECT * FROM "${schema}"."MD_ORDERS" WHERE "REF" = :master.MISSING`,
          );
          await dialog.getByRole("button", { name: "Vorschau", exact: true }).click();
          await preview.getByRole("alert").filter({ hasText: "MISSING" }).waitFor();
          expect(calls.length).toBe(beforeInvalid);
          await replaceSql(
            page,
            editor,
            `SELECT "DOES_NOT_EXIST" FROM "${schema}"."MD_ORDERS" WHERE "REF" = :master.REF`,
          );
          await dialog.getByRole("button", { name: "Vorschau", exact: true }).click();
          await preview
            .getByRole("alert")
            .filter({ hasText: /DOES_NOT_EXIST|does_not_exist/ })
            .waitFor();
          await replaceSql(page, editor, `SELECT * FROM "${schema}"."MD_ORDERS" WHERE "REF" = `);
          await dialog.getByLabel("Master-Spaltenreferenz einfügen").click();
          await page.getByRole("option", { name: "REF", exact: true }).click();
          await dialog.getByRole("button", { name: "Vorschau", exact: true }).click();
          await preview.getByText("Erster Auftrag", { exact: true }).waitFor();
          expect(calls.at(-1)?.params).toEqual(["101"]);
          await dialog.getByRole("button", { name: "Abbrechen", exact: true }).click();
          await detail.getByText("Tenant A", { exact: true }).waitFor();
          await link.click();
          await dialog.getByRole("button", { name: "Verknüpfung entfernen" }).click();
          await link.click();
          await dialog.getByText("Gespeicherte SQL-Vorlagen", { exact: true }).click();
          await dialog.getByRole("button", { name: "SQL laden", exact: true }).click();
          await dialog.getByRole("button", { name: "Speichern & anwenden" }).click();
          await detail.getByText("Tenant A", { exact: true }).waitFor();
          expect(errors).toEqual([]);
        } catch (error) {
          await page.screenshot({ path: `/tmp/l8db-master-detail-${kind}-${engine}-failure.png` });
          throw error;
        } finally {
          await browser.close();
        }
      },
      120000,
    );
  }
}
