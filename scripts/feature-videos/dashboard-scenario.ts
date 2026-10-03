import type { Page } from "playwright";

export async function seedDashboardVideo(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const internals = (
      window as unknown as {
        __TAURI_INTERNALS__: {
          invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
        };
      }
    ).__TAURI_INTERNALS__;
    const original = internals.invoke;
    internals.invoke = async (command, args) => {
      if (command === "list_databases") return ["analytics_demo"];
      if (command === "list_schemas") return ["public"];
      if (command === "list_tables") return [{ schema: "public", name: "orders" }];
      if (command === "list_views" || command === "list_foreign_keys") return [];
      if (command === "list_table_columns_detailed")
        return [
          { name: "created_at", data_type: "timestamp", is_primary_key: false },
          { name: "revenue", data_type: "numeric", is_primary_key: false },
          { name: "country", data_type: "text", is_primary_key: false },
        ];
      if (command === "execute_query") {
        const split = String(args?.sql ?? "").includes('"dim2"');
        const revenue = [12140, 13860, 12940, 17320, 16280, 19840, 18210, 22460];
        const rows = revenue.flatMap((value, index) => {
          const dim = `2026-${String(index + 1).padStart(2, "0")}-01`;
          return split
            ? [
                { dim, dim2: "Deutschland", m0: value },
                { dim, dim2: "Österreich", m0: Math.round(value * 0.63) },
              ]
            : [{ dim, m0: value }];
        });
        return {
          columns: split ? ["dim", "dim2", "m0"] : ["dim", "m0"],
          rows,
          rows_affected: null,
          execution_time_ms: 8,
        };
      }
      return original(command, args);
    };
    localStorage.setItem("theme", "light");
    localStorage.setItem(
      "l8db.connections",
      JSON.stringify({
        state: {
          connections: [
            {
              id: "dashboard-video",
              name: "Analytics · Beispieldaten",
              kind: "postgres",
              connectionString: "postgres://demo@localhost/analytics_demo",
              sslMode: "disable",
            },
          ],
          activeId: "dashboard-video",
          favoriteServerKeys: [],
          serverOrder: [],
        },
        version: 0,
      }),
    );
    localStorage.setItem(
      "l8db-dashboards",
      JSON.stringify({
        state: {
          dashboards: [
            {
              id: "dashboard-video",
              connectionId: "dashboard-video",
              database: "analytics_demo",
              name: "Vertriebsüberblick · Demo",
              datasets: [
                {
                  id: "revenue",
                  name: "Umsatz pro Monat",
                  mode: "simple",
                  simple: {
                    schema: "public",
                    table: "orders",
                    join: null,
                    joins: [],
                    dimension: { column: "created_at", bucket: "month" },
                    dimension2: null,
                    metrics: [{ id: "revenue", agg: "sum", column: "revenue", label: "Umsatz" }],
                    filters: [],
                    dateColumn: "created_at",
                    sort: "dimension",
                    limit: 50,
                  },
                  sql: "",
                  mapping: { dimension: null, dimension2: null, metrics: [], dateColumn: null },
                },
              ],
              widgets: [
                {
                  id: "revenue",
                  chart: "line",
                  datasetId: "revenue",
                  title: "Umsatz pro Monat",
                  period: "all",
                  x: 2,
                  y: 0,
                  w: 8,
                  h: 7,
                  options: { colorOffset: 1 },
                },
              ],
              refreshSec: 0,
              locked: false,
              createdAt: 1,
            },
          ],
          active: { "dashboard-video": "dashboard-video" },
        },
        version: 0,
      }),
    );
  });
}
