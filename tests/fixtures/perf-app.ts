import type { Page } from "playwright";

export const CHART_KINDS = [
  "kpi",
  "area",
  "line",
  "column",
  "bars",
  "donut",
  "radar",
  "scatter",
  "treemap",
  "heatmap",
  "table",
  "gauge",
];

export async function seedApp(
  page: Page,
  tables: number,
  grid = { rows: 500, columns: 24 },
): Promise<void> {
  await page.addInitScript(
    ({ count, rowCount, columnCount }) => {
      const names = Array.from({ length: count }, (_, i) => `table_${String(i).padStart(4, "0")}`);
      const columns = Array.from({ length: columnCount }, (_, i) => ({
        name: i === 0 ? "id" : `col_${i}`,
        data_type: i === 0 ? "integer" : i % 3 === 0 ? "text" : "numeric",
        is_nullable: i !== 0,
        column_default: null,
        is_primary_key: i === 0,
        ordinal_position: i + 1,
        character_maximum_length: null,
      }));
      const rows = Array.from({ length: rowCount }, (_, row) => {
        const record: Record<string, unknown> = { __ctid__: `(0,${row})` };
        for (const column of columns)
          record[column.name] = column.name === "id" ? row : `value ${row * 13}`;
        return record;
      });
      const invoke = async (command: string, args: Record<string, unknown> | undefined) => {
        switch (command) {
          case "list_databases":
            return ["l8db_perf"];
          case "list_schemas":
            return ["public"];
          case "list_tables":
            return names.map((name) => ({ schema: "public", name }));
          case "list_views":
            return names.slice(0, 400).map((name) => ({ schema: "public", name: `v_${name}` }));
          case "list_materialized_views":
            return names.slice(0, 300).map((name) => ({
              schema: "public",
              name: `mv_${name}`,
              is_populated: true,
            }));
          case "list_functions":
          case "list_procedures":
            return names.slice(0, 900).map((name, i) => ({
              schema: "public",
              name: `fn_${name}`,
              identity_args: "integer, text",
              return_type: "integer",
              language: "plpgsql",
              oid: String(10000 + i),
            }));
          case "list_sequences":
            return names.slice(0, 800).map((name) => ({
              schema: "public",
              name: `${name}_id_seq`,
              data_type: "bigint",
              start_value: "1",
              min_value: "1",
              max_value: "9223372036854775807",
              increment_by: "1",
              cycle: false,
              last_value: "42",
            }));
          case "list_roles":
            return Array.from({ length: 600 }, (_, i) => ({
              name: `role_${i}`,
              oid: String(20000 + i),
              superuser: false,
              can_login: i % 2 === 0,
              create_db: false,
              create_role: false,
              replication: false,
              bypass_rls: false,
              conn_limit: -1,
              valid_until: null,
              member_of: [],
              members: [],
            }));
          case "list_all_columns":
            return names.slice(0, 500).flatMap((table) =>
              columns.map((column) => ({
                schema: "public",
                table,
                name: column.name,
                data_type: column.data_type,
              })),
            );
          case "list_table_columns_detailed":
            return columns;
          case "fetch_table_rows":
            return { columns: columns.map((column) => column.name), rows };
          case "count_table_rows":
            return rows.length;
          case "get_database_overview":
            return {
              size_bytes: 123456789,
              schemas: Array.from({ length: 8 }, (_, i) => ({
                name: `schema_${i}`,
                size_bytes: 10000000 - i * 900000,
                table_count: 40,
              })),
              tables: names.map((name, i) => ({
                schema: "public",
                name,
                size_bytes: 5000000 - i * 100,
                row_estimate: 100000 - i,
              })),
            };
          case "execute_query":
            return String(args?.sql ?? "").includes("perf")
              ? {
                  columns: ["label", "value", "value2"],
                  rows: Array.from({ length: 200 }, (_, i) => ({
                    label: `bucket ${i}`,
                    value: String(1000 + ((i * 37) % 900)),
                    value2: String(500 + ((i * 17) % 400)),
                  })),
                  rows_affected: 200,
                  execution_time_ms: 4,
                }
              : { columns: [], rows: [], rows_affected: 0, execution_time_ms: 1 };
          case "load_secret":
            return null;
          default:
            return [];
        }
      };
      Object.assign(window, {
        __TAURI_INTERNALS__: {
          metadata: {
            currentWindow: { label: "main" },
            currentWebview: { windowLabel: "main", label: "main" },
          },
          transformCallback: (callback: unknown) => {
            const id = Math.random();
            Object.assign(window, { [`_${id}`]: callback });
            return id;
          },
          convertFileSrc: (path: string) => path,
          invoke,
        },
      });
    },
    { count: tables, rowCount: grid.rows, columnCount: grid.columns },
  );

  await page.addInitScript((charts: string[]) => {
    localStorage.setItem(
      "l8db.connections",
      JSON.stringify({
        state: {
          connections: [
            {
              id: "perf",
              name: "perf",
              kind: "postgres",
              connectionString: "postgresql://leon@localhost:5432/l8db_perf",
              sslMode: "disable",
            },
          ],
          activeId: "perf",
          favoriteServerKeys: [],
          serverOrder: [],
        },
        version: 0,
      }),
    );
    localStorage.setItem(
      "l8db.settings",
      JSON.stringify({ state: { tourFinished: true }, version: 0 }),
    );
    localStorage.setItem(
      "l8db.db-selection",
      JSON.stringify({ state: { database: "l8db_perf", schema: "public" }, version: 0 }),
    );
    localStorage.setItem(
      "l8db-dashboards",
      JSON.stringify({
        state: {
          dashboards: [
            {
              id: "dash1",
              connectionId: "perf",
              database: "l8db_perf",
              name: "Perf",
              datasets: [
                {
                  id: "ds1",
                  name: "Perf",
                  mode: "expert",
                  simple: {
                    schema: "public",
                    table: "table_0000",
                    join: null,
                    dimension: null,
                    dimension2: null,
                    metrics: [],
                    filters: [],
                    dateColumn: null,
                    sort: "none",
                    limit: 100,
                  },
                  sql: "select label, value from perf",
                  mapping: {
                    dimension: "label",
                    dimension2: null,
                    metrics: ["value", "value2"],
                    dateColumn: null,
                  },
                },
              ],
              widgets: charts.map((chart, i) => ({
                id: `w${i}`,
                chart,
                datasetId: "ds1",
                title: chart,
                period: "all",
                x: (i % 2) * 6,
                y: Math.floor(i / 2) * 7,
                w: 6,
                h: 7,
              })),
              refreshSec: 0,
              locked: false,
              createdAt: 1,
            },
          ],
          active: { perf: "dash1" },
        },
        version: 0,
      }),
    );
  }, CHART_KINDS);
}
