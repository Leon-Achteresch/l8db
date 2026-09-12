import { expect, test } from "bun:test";
import { chromium } from "playwright";

test.skipIf(!process.env.L8DB_DASH_WORKFLOW)(
  "guided dashboard workflow and read-only isolation",
  async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.addInitScript(() => {
        const runtime = window as unknown as Record<string, unknown>;
        runtime.__TAURI_INTERNALS__ = {
          metadata: {
            currentWindow: { label: "main" },
            currentWebview: { label: "main", windowLabel: "main" },
          },
          transformCallback: () => Math.floor(Math.random() * 1e9),
          convertFileSrc: (p: string) => p,
          plugins: {},
          invoke: async (cmd: string) => {
            if (cmd === "list_providers") return [];
            if (cmd === "list_schemas") return ["public"];
            if (cmd === "list_databases") return ["demo"];
            if (cmd === "list_tables") return [{ schema: "public", name: "orders" }];
            if (cmd === "list_views") return [{ schema: "public", name: "monthly_sales" }];
            if (cmd === "list_table_columns_detailed")
              return [
                { name: "month", data_type: "date", is_primary_key: false },
                { name: "revenue", data_type: "numeric", is_primary_key: false },
              ];
            if (cmd === "list_foreign_keys") return [];
            if (cmd === "get_er_schema") return { tables: [], foreign_keys: [] };
            if (cmd === "execute_query")
              return {
                columns: ["dim", "m0"],
                rows: [
                  { dim: "2026-01-01", m0: 420 },
                  { dim: "2026-02-01", m0: 610 },
                ],
                execution_time_ms: 3,
                rows_affected: null,
              };
            return null;
          },
        };
        runtime.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
        localStorage.setItem(
          "l8db.settings",
          JSON.stringify({ state: { tourFinished: true }, version: 0 }),
        );
        localStorage.setItem(
          "l8db.connections",
          JSON.stringify({
            state: {
              connections: [
                {
                  id: "workflow",
                  name: "Workflow Demo",
                  kind: "postgres",
                  connectionString: "postgres://demo@localhost/demo",
                  sslMode: "disable",
                },
              ],
              activeId: "workflow",
              favoriteServerKeys: [],
              serverOrder: [],
            },
            version: 0,
          }),
        );
      });
      await page.goto(`${process.env.L8DB_DASH_URL ?? "http://localhost:1420"}/dashboard`);
      await page.getByRole("button", { name: "Dashboard erstellen", exact: true }).click();
      await page.getByRole("button", { name: "Ersten Datensatz anlegen" }).click();
      await page.getByRole("button", { name: /monthly_sales/ }).click();
      await page.getByLabel("Name des Datensatzes").fill("Umsatzübersicht");
      await page.getByRole("button", { name: "Weiter →", exact: true }).click();
      expect(await page.getByText("Was möchtest du messen?", { exact: true }).isVisible()).toBe(
        true,
      );
      await page.getByRole("button", { name: "3. Gruppieren", exact: true }).click();
      await page.getByRole("combobox").filter({ hasText: "Nicht aufteilen" }).click();
      await page.getByRole("option", { name: /month/ }).click();
      await page.getByRole("button", { name: "4. Filtern", exact: true }).click();
      await page.getByRole("combobox").filter({ hasText: "Keine Zeitspalte" }).click();
      await page.getByRole("option", { name: /month/ }).click();
      await page.getByRole("option").first().waitFor({ state: "hidden" });
      await page.getByText("2 Zeilen · 3 ms", { exact: true }).waitFor();
      await page.screenshot({ path: "/tmp/l8db-workflow-data.png" });
      await page.getByRole("button", { name: "Weiter zu Charts →" }).click();
      await page.getByRole("button", { name: /^Säulen/ }).click();
      await page.getByLabel("Chart-Titel").fill("Umsatz pro Monat");
      expect(await page.getByLabel("Chart bearbeiten", { exact: true }).isVisible()).toBe(true);
      await page.screenshot({ path: "/tmp/l8db-workflow-chart.png" });
      await page.getByRole("button", { name: "Weiter zum Dashboard →" }).click();
      expect(await page.locator(".react-grid-item").count()).toBe(1);
      await page.getByRole("button", { name: /Read-only/ }).click();
      expect(await page.getByLabel("Widget-Einstellungen").count()).toBe(0);
      expect(await page.locator(".widget-drag-handle").count()).toBe(0);
      await page.waitForTimeout(500);
      const before = await page.evaluate(
        () => JSON.parse(localStorage.getItem("l8db-dashboards")!).state.dashboards[0],
      );
      await page.locator(".react-grid-item").getByRole("combobox").click();
      await page.getByRole("option", { name: "Letzte 7 Tage", exact: true }).click();
      await page.waitForTimeout(500);
      const after = await page.evaluate(
        () => JSON.parse(localStorage.getItem("l8db-dashboards")!).state.dashboards[0],
      );
      expect(after.widgets).toEqual(before.widgets);
      await page.screenshot({ path: "/tmp/l8db-workflow-read.png" });
      await page.getByLabel("Alle Charts neu laden").hover();
      await page.getByRole("tooltip", { name: "Alle Charts neu laden" }).waitFor();
      await page
        .getByRole("button", { name: "Charts", exact: false })
        .filter({ hasText: "Daten visualisieren" })
        .click();
      await page.getByRole("button", { name: "Duplizieren", exact: true }).click();
      await page
        .getByRole("button", { name: "Daten nur für diesen Chart anpassen", exact: true })
        .click();
      await page.getByLabel("Name des Datensatzes").fill("Eigene Chart-Daten");
      await page.getByRole("button", { name: "Weiter zu Charts →" }).click();
      await page.waitForTimeout(500);
      const customized = await page.evaluate(
        () => JSON.parse(localStorage.getItem("l8db-dashboards")!).state.dashboards[0],
      );
      expect(customized.datasets.length).toBe(2);
      expect(customized.widgets.length).toBe(2);
      expect(customized.widgets[0].datasetId).not.toBe(customized.widgets[1].datasetId);
      expect(customized.datasets[0].name).toBe("Umsatzübersicht");
      expect(customized.datasets[1].name).toBe("Eigene Chart-Daten");
      await page.setViewportSize({ width: 900, height: 900 });
      await page.screenshot({ path: "/tmp/l8db-workflow-compact.png" });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      expect(errors).toEqual([]);
    } finally {
      await page.screenshot({ path: "/tmp/l8db-workflow-last.png" });
      await browser.close();
    }
  },
  60000,
);
