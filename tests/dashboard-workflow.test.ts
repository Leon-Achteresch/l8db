import { expect, test } from "bun:test";
import { chromium } from "playwright";

test.skipIf(!process.env.L8DB_DASH_WORKFLOW)(
  "chart-first drag-and-drop workflow, filters and independent data",
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
          invoke: async (
            cmd: string,
            rawArgs?:
              | { sql?: string; path?: string; options?: { defaultPath?: string } }
              | Uint8Array,
            options?: { headers?: { path?: string } },
          ) => {
            const args = rawArgs as
              | { sql?: string; path?: string; options?: { defaultPath?: string } }
              | undefined;
            if (cmd === "plugin:dialog|save")
              return `/tmp/${args?.options?.defaultPath ?? "saved.json"}`;
            if (cmd === "plugin:dialog|open") return localStorage.getItem("test.lastFile");
            if (cmd === "plugin:fs|write_text_file") {
              const path = decodeURIComponent(options?.headers?.path ?? "");
              localStorage.setItem(
                `test.file.${path}`,
                new TextDecoder().decode(rawArgs as Uint8Array),
              );
              localStorage.setItem("test.lastFile", path);
              return null;
            }
            if (cmd === "plugin:fs|read_text_file")
              return Array.from(
                new TextEncoder().encode(localStorage.getItem(`test.file.${args?.path}`) ?? ""),
              );
            if (cmd === "plugin:fs|stat") return { mtime: 0, size: 100 };
            if (cmd === "list_providers") return [];
            if (cmd === "list_schemas") return ["public"];
            if (cmd === "list_databases") return ["demo"];
            if (cmd === "list_tables") return [{ schema: "public", name: "orders" }];
            if (cmd === "list_views") return [{ schema: "public", name: "monthly_sales" }];
            if (cmd === "list_table_columns_detailed")
              return [
                { name: "month", data_type: "date", is_primary_key: false },
                { name: "revenue", data_type: "numeric", is_primary_key: false },
                { name: "country", data_type: "text", is_primary_key: false },
              ];
            if (cmd === "list_foreign_keys") return [];
            if (cmd === "get_er_schema") return { tables: [], foreign_keys: [] };
            if (cmd === "execute_query")
              return {
                columns: ["dim", "dim2", "m0"],
                rows: args?.sql?.includes('GROUP BY "country"')
                  ? [
                      { dim: "DE", m0: 2 },
                      { dim: "US", m0: 1 },
                    ]
                  : [
                      { dim: "2026-01-01", dim2: "DE", m0: 420 },
                      { dim: "2026-01-01", dim2: "US", m0: 610 },
                      { dim: "2026-02-01", dim2: "DE", m0: 300 },
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
      const navigation = page.getByRole("navigation", { name: "Arbeitsbereiche" });
      expect(await navigation.getByRole("button").count()).toBe(2);
      await page.getByRole("button", { name: "Ersten Chart hinzufügen", exact: true }).click();
      await page.getByLabel("Datenquelle", { exact: true }).click();
      await page.getByRole("option", { name: /monthly_sales/ }).click();
      const field = (name: string) => page.locator(`[data-worksheet-field="${name}"]`);
      const shelf = (name: string) => page.locator(`[data-field-shelf^="${name}"]`);
      await field("revenue").dragTo(shelf("Zeilen"));
      await field("month").dragTo(shelf("Spalten"));
      await page.getByLabel("Chart-Titel", { exact: true }).fill("Umsatz pro Monat");
      await field("country").dragTo(shelf("Farbe"));
      await page.locator(".recharts-surface").first().waitFor();
      await page.screenshot({ path: "/tmp/l8db-tableau-fields.png" });
      await field("country").dragTo(shelf("Filter"));
      const filterEditor = page.getByRole("region", { name: "Filter für country" });
      await filterEditor.getByRole("checkbox", { name: "DE", exact: true }).check();
      await filterEditor.getByRole("button", { name: "Filter anwenden" }).click();
      expect(await shelf("Filter").innerText()).toContain("DE");
      await page.getByLabel("Änderung rückgängig machen", { exact: true }).click();
      expect(await shelf("Filter").innerText()).not.toContain("DE");
      await page.getByLabel("Änderung wiederholen", { exact: true }).click();
      await field("revenue").dragTo(shelf("Filter"));
      await page.getByLabel("Filter von", { exact: true }).fill("100");
      await page.getByLabel("Filter bis", { exact: true }).fill("1000");
      await page.getByRole("button", { name: "Filter anwenden" }).click();
      await page.getByRole("button", { name: "Summe · revenue einstellen", exact: true }).click();
      await page.getByLabel("Berechnung revenue", { exact: true }).click();
      await page.getByRole("option", { name: "Durchschnitt", exact: true }).click();
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Achsen tauschen", exact: true }).click();
      expect(await shelf("Spalten").innerText()).toContain("Durchschnitt");
      expect(await shelf("Zeilen").innerText()).toContain("month");
      await page.getByRole("button", { name: "Duplizieren", exact: true }).click();
      await page.getByRole("button", { name: /^revenue .*entfernen$/ }).click();
      await page.waitForTimeout(400);
      const stored = await page.evaluate(
        () => JSON.parse(localStorage.getItem("l8db-dashboards")!).state.dashboards[0],
      );
      const original = stored.datasets.find(
        (d: { id: string }) => d.id === stored.widgets[0].datasetId,
      );
      const copied = stored.datasets.find(
        (d: { id: string }) => d.id === stored.widgets[1].datasetId,
      );
      expect(original.simple.filters.length).toBe(3);
      expect(copied.simple.filters.length).toBe(1);
      expect(original.simple.metrics[0].agg).toBe("avg");
      expect(stored.widgets[0].options.horizontal).toBe(true);
      expect(stored.widgets[0].datasetId).not.toBe(stored.widgets[1].datasetId);
      await page.getByRole("button", { name: "Zum Dashboard →", exact: true }).click();
      expect(await page.locator(".react-grid-item").count()).toBe(2);
      await page.getByLabel("Zur Ansicht wechseln", { exact: true }).click();
      expect(await page.getByLabel("Widget-Einstellungen").count()).toBe(0);
      expect(await page.locator(".widget-drag-handle").count()).toBe(0);
      await page.screenshot({ path: "/tmp/l8db-tableau-dashboard.png" });
      await navigation.getByRole("button", { name: /^Charts/ }).click();
      await page.getByRole("button", { name: "Chart hinzufügen", exact: true }).click();
      await field("revenue").click();
      await page.getByRole("button", { name: "Zum Chart hinzufügen", exact: true }).click();
      await field("month").dblclick();
      expect(await shelf("Spalten").innerText()).toContain("month");
      expect(await shelf("Zeilen").innerText()).toContain("Summe");
      await page.getByLabel("Änderung rückgängig machen", { exact: true }).hover();
      await page.getByRole("tooltip", { name: "Änderung rückgängig machen" }).waitFor();
      await page.getByRole("button", { name: "Gespeicherte Charts", exact: true }).click();
      const chartsDrawer = page.getByRole("dialog", { name: "Gespeicherte Charts", exact: true });
      await chartsDrawer.getByRole("button", { name: "Chart speichern", exact: true }).click();
      const rightResize = page.getByRole("separator", { name: "Breite von Gespeicherte Charts" });
      await rightResize.focus();
      await page.keyboard.press("ArrowLeft");
      expect(await rightResize.getAttribute("aria-valuenow")).toBe("420");
      await chartsDrawer.getByRole("button", { name: "Ins Dashboard laden", exact: true }).click();
      await page.waitForTimeout(400);
      const savedState = await page.evaluate(
        () => JSON.parse(localStorage.getItem("l8db-dashboards")!).state.dashboards[0],
      );
      expect(savedState.widgets.length).toBe(4);
      expect(new Set(savedState.widgets.map((w: { datasetId: string }) => w.datasetId)).size).toBe(
        4,
      );
      await page.getByRole("button", { name: "Dashboards", exact: true }).click();
      const leftResize = page.getByRole("separator", {
        name: "Breite von Dashboards",
        exact: true,
      });
      await leftResize.hover();
      const handle = (await leftResize.boundingBox())!;
      await page.mouse.move(handle.x + handle.width / 2, handle.y + 200);
      await page.mouse.down();
      await page.mouse.move(handle.x + handle.width / 2 + 100, handle.y + 200, { steps: 5 });
      await page.mouse.up();
      expect(await leftResize.getAttribute("aria-valuenow")).toBe("480");
      await page.screenshot({ path: "/tmp/l8db-dashboard-drawer.png" });
      await page.getByRole("button", { name: "Dashboards schließen" }).click();
      await page.waitForTimeout(400);
      await page.reload();
      await page.getByRole("button", { name: "Dashboards", exact: true }).click();
      expect(await leftResize.getAttribute("aria-valuenow")).toBe("480");
      await page.getByRole("button", { name: "Dashboards schließen" }).click();
      await page.getByRole("button", { name: "Gespeicherte Charts", exact: true }).click();
      expect(await rightResize.getAttribute("aria-valuenow")).toBe("420");
      expect(await chartsDrawer.getByRole("button", { name: "Ins Dashboard laden" }).count()).toBe(
        1,
      );
      await page.screenshot({ path: "/tmp/l8db-chart-drawer.png" });
      await page.getByRole("button", { name: "Gespeicherte Charts schließen" }).click();
      await page.setViewportSize({ width: 1000, height: 900 });
      await page.screenshot({ path: "/tmp/l8db-tableau-compact.png" });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await page.getByRole("button", { name: "Gespeicherte Charts", exact: true }).click();
      await chartsDrawer.getByRole("button", { name: "Als Datei speichern", exact: true }).click();
      await page.waitForFunction(() =>
        localStorage.getItem("test.lastFile")?.endsWith(".chart.json"),
      );
      const chartFile = await page.evaluate(() =>
        JSON.parse(localStorage.getItem(`test.file.${localStorage.getItem("test.lastFile")}`)!),
      );
      expect(chartFile.format).toBe("l8db-chart");
      expect(chartFile.dataset.simple.metrics[0].agg).toBe("avg");
      expect(chartFile.connectionId).toBeUndefined();
      await chartsDrawer.getByRole("button", { name: "Aus Datei laden", exact: true }).click();
      await chartsDrawer.waitFor({ state: "hidden" });
      await page.getByRole("button", { name: "Dashboards", exact: true }).click();
      const dashboardDrawer = page.getByRole("dialog", { name: "Dashboards", exact: true });
      await dashboardDrawer
        .getByRole("button", { name: "Dashboard speichern", exact: true })
        .click();
      await page.waitForFunction(
        () =>
          localStorage.getItem("test.lastFile")?.endsWith(".json") &&
          !localStorage.getItem("test.lastFile")?.endsWith(".chart.json"),
      );
      const dashboardFile = await page.evaluate(() =>
        JSON.parse(localStorage.getItem(`test.file.${localStorage.getItem("test.lastFile")}`)!),
      );
      expect(dashboardFile.widgets.length).toBe(5);
      expect(dashboardFile.connectionId).toBeUndefined();
      await dashboardDrawer.getByRole("button", { name: "Aus Datei laden", exact: true }).click();
      await dashboardDrawer.waitFor({ state: "hidden" });
      await page.locator(".react-grid-item").first().waitFor();
      expect(await page.locator(".react-grid-item").count()).toBe(5);
      expect(errors).toEqual([]);
    } finally {
      await page.screenshot({ path: "/tmp/l8db-tableau-last.png" });
      await browser.close();
    }
  },
  120000,
);
