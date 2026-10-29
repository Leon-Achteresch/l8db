import { resolve } from "node:path";
import type { Page } from "playwright";
import config from "../../src-tauri/tauri.conf.json";

export function serveBuiltApp(root = resolve("dist")) {
  const policy = Object.entries(config.app.security.csp)
    .map(([name, value]) => `${name} ${value}`)
    .join("; ");
  return Bun.serve({
    port: 0,
    async fetch(request) {
      const pathname = new URL(request.url).pathname;
      const path = resolve(root, `.${pathname}`);
      if (!path.startsWith(`${root}/`) && path !== root) return new Response(null, { status: 403 });
      const file = Bun.file(path);
      if (pathname !== "/" && (await file.exists())) return new Response(file);
      return new Response(Bun.file(resolve(root, "index.html")), {
        headers: { "Content-Type": "text/html", "Content-Security-Policy": policy },
      });
    },
  });
}

export type DemoTab = { schema: string; table: string };

export async function navigateInApp(page: Page, path: string) {
  await page.evaluate((target) => {
    history.pushState({}, "", target);
    dispatchEvent(new PopStateEvent("popstate", { state: history.state }));
  }, path);
}

export async function connectDemo(page: Page, path: string) {
  await page.locator('[data-tour="sidebar-connection"]').getByText("Keine Verbindung").click();
  await page.getByText("Shop Produktion").first().click();
  await page.getByText("Mit „Shop Produktion“ verbunden").waitFor();
  await navigateInApp(page, path);
}

export const CATALOG_URL =
  "https://raw.githubusercontent.com/Leon-Achteresch/l8db-ui-plugins/catalog/";

export type CatalogPlugin = { id: string; name: string; source: string };

async function serveCatalog(page: Page, plugins: readonly CatalogPlugin[]) {
  const files = new Map(
    plugins.map((plugin) => [`plugins/${plugin.id}/plugin.tsx`, plugin.source]),
  );
  const catalog = JSON.stringify({
    schemaVersion: 1,
    plugins: plugins.map((plugin) => ({
      id: plugin.id,
      name: plugin.name,
      description: `${plugin.name} aus der Test-Galerie.`,
      version: "1.0.0",
      author: "test",
      file: `plugins/${plugin.id}/plugin.tsx`,
      sha256: new Bun.CryptoHasher("sha256").update(plugin.source).digest("hex"),
      tags: ["grid"],
      http: [],
    })),
  });
  await page.route(`${CATALOG_URL}**`, (route) => {
    const path = route.request().url().slice(CATALOG_URL.length);
    const body = path === "catalog.json" ? catalog : files.get(path);
    return route.fulfill({
      status: body === undefined ? 404 : 200,
      body: body ?? "",
      headers: { "access-control-allow-origin": "*" },
    });
  });
}

export async function seedUiPluginApp(
  page: Page,
  plugins: Record<string, string>,
  options: {
    tabs?: DemoTab[];
    settings?: Record<string, unknown>;
    uiPlugins?: unknown;
    environment?: "production" | "staging" | "test" | "development" | null;
    catalog?: readonly CatalogPlugin[];
  } = {},
): Promise<void> {
  await serveCatalog(page, options.catalog ?? []);
  await page.addInitScript(
    ({ plugins, tabs, settings, uiPlugins, environment }) => {
      const day = 86_400_000;
      const now = Date.now();
      const iso = (offset: number) => new Date(now + offset * day).toISOString().slice(0, 10);
      const stamp = (offset: number) => new Date(now + offset * 3_600_000).toISOString();
      const customers = [
        "Müller Logistik GmbH",
        "Brandt & Söhne KG",
        "Nordlicht Media",
        "Alpenblick Hotels",
        "Kessler Maschinenbau",
        "Hafenkontor Bremen",
        "Sonnenfeld Bio AG",
        "Weber Elektrotechnik",
        "Rheinwerk Software",
        "Lindner Feinkost",
        "Fischer Bau GmbH",
        "Grünwald Apotheken",
      ];
      const orderStatus = ["offen", "bezahlt", "versendet", "storniert", "bezahlt", "versendet"];
      const ticketStatus = ["neu", "in Arbeit", "wartet", "erledigt"];
      const products = [
        "Lagerregal XL",
        "Palettenwaage",
        "Hubwagen",
        "Etikettendrucker",
        "Scanner Pro",
        "Kabeltrommel",
      ];
      const people = ["Anna", "Ben", "Clara", "Deniz", "Emil", "Fatma"];
      const columns = (list: [string, string][], key = "id") =>
        list.map(([name, type], index) => ({
          name,
          data_type: type,
          is_nullable: name !== key,
          column_default: null,
          is_primary_key: name === key,
          ordinal_position: index + 1,
          character_maximum_length: null,
        }));
      const tables: Record<
        string,
        { columns: ReturnType<typeof columns>; rows: Record<string, unknown>[] }
      > = {
        "sales.orders": {
          columns: columns([
            ["id", "integer"],
            ["customer", "text"],
            ["status", "text"],
            ["total", "numeric"],
            ["paid_percent", "integer"],
            ["due_date", "date"],
            ["created_at", "timestamp with time zone"],
            ["updated_by", "text"],
          ]),
          rows: Array.from({ length: 48 }, (_, index) => ({
            id: 10_480 + index,
            customer: customers[index % customers.length],
            status: orderStatus[(index * 5) % orderStatus.length],
            total: (((index * 7919) % 18_000) / 3 + 120).toFixed(2),
            paid_percent: (index * 37) % 101,
            due_date: iso(((index * 11) % 40) - 14),
            created_at: stamp(-index * 9),
            updated_by: people[index % people.length].toLowerCase(),
          })),
        },
        "sales.order_items": {
          columns: columns([
            ["id", "integer"],
            ["order_id", "integer"],
            ["product", "text"],
            ["quantity", "integer"],
            ["price", "numeric"],
          ]),
          rows: Array.from({ length: 120 }, (_, index) => ({
            id: 90_000 + index,
            order_id: 10_480 + (index % 48),
            product: products[index % products.length],
            quantity: 1 + ((index * 3) % 9),
            price: (19.9 + ((index * 131) % 900)).toFixed(2),
          })),
        },
        "crm.customers": {
          columns: columns([
            ["id", "integer"],
            ["name", "text"],
            ["country", "text"],
            ["revenue", "numeric"],
            ["satisfaction", "integer"],
            ["last_contact", "date"],
          ]),
          rows: customers.map((name, index) => ({
            id: 300 + index,
            name,
            country: ["DE", "AT", "CH"][index % 3],
            revenue: (12_000 + ((index * 48_271) % 240_000)).toFixed(2),
            satisfaction: 40 + ((index * 17) % 61),
            last_contact: iso(-((index * 13) % 90)),
          })),
        },
        "crm.tickets": {
          columns: columns([
            ["id", "integer"],
            ["customer_id", "integer"],
            ["title", "text"],
            ["status", "text"],
            ["priority", "text"],
            ["assignee", "text"],
            ["updated_at", "timestamp with time zone"],
          ]),
          rows: Array.from({ length: 26 }, (_, index) => ({
            id: 7_100 + index,
            customer_id: 300 + (index % customers.length),
            title: [
              "Lieferung unvollständig",
              "Rechnung doppelt",
              "Zugang gesperrt",
              "Rückfrage zum Angebot",
              "Scanner meldet Fehler 42",
              "Termin verschieben",
              "Gutschrift fehlt",
            ][index % 7],
            status: ticketStatus[(index * 3) % ticketStatus.length],
            priority: ["hoch", "mittel", "niedrig"][index % 3],
            assignee: people[(index * 2) % people.length],
            updated_at: stamp(-index * 5),
          })),
        },
      };
      const handlers = new Map<string, number[]>();
      const pluginFiles = new Map<string, string>(Object.entries(plugins));
      const written: Record<string, string> = {};
      const calls: { command: string; args: Record<string, unknown> }[] = [];
      const rowsOf = (schema: unknown, table: unknown) => tables[`${schema}.${table}`];
      const unquote = (name: string) => name.replace(/""/g, '"');
      const filtered = (rows: Record<string, unknown>[], filter: unknown) => {
        const pattern = /"((?:[^"]|"")+)"\s*=\s*(?:'((?:[^']|'')*)'|(-?\d+(?:\.\d+)?))/g;
        const conditions = [...String(filter ?? "").matchAll(pattern)].map((match) => ({
          column: unquote(match[1]),
          value: match[2] === undefined ? match[3] : match[2].replace(/''/g, "'"),
        }));
        return rows.filter((row) =>
          conditions.every(({ column, value }) => String(row[column]) === value),
        );
      };
      const invoke = async (command: string, args: Record<string, unknown> = {}) => {
        if (!command.startsWith("plugin:event")) calls.push({ command, args });
        switch (command) {
          case "load_secret":
            return args.account === "shop" ? "demo" : null;
          case "list_databases":
            return ["shop"];
          case "list_schemas":
            return ["crm", "public", "sales"];
          case "list_tables":
            return Object.keys(tables)
              .map((key) => key.split("."))
              .filter(([schema]) => !args.schema || args.schema === schema)
              .map(([schema, name]) => ({ schema, name }));
          case "list_table_columns_detailed":
            return rowsOf(args.schema, args.table)?.columns ?? [];
          case "fetch_table_rows": {
            const data = rowsOf(args.schema, args.table);
            if (!data) return { columns: [], rows: [] };
            const rows = filtered(data.rows, args.filter);
            const offset = Number(args.offset ?? 0);
            const limit = Number(args.limit ?? rows.length);
            return {
              columns: data.columns.map((column) => column.name),
              rows: rows
                .slice(offset, offset + limit)
                .map((row) => ({ __ctid__: `(0,${data.rows.indexOf(row)})`, ...row })),
            };
          }
          case "count_table_rows": {
            const data = rowsOf(args.schema, args.table);
            return data ? filtered(data.rows, args.filter).length : 0;
          }
          case "count_table_rows_capped": {
            const data = rowsOf(args.schema, args.table);
            const count = data ? filtered(data.rows, args.filter).length : 0;
            return { count, exact: true, estimate: null };
          }
          case "execute_query_with_params": {
            const sql = String(args.sql ?? "");
            const params = (args.params as (string | null)[] | undefined) ?? [];
            const from = /from\s+"((?:[^"]|"")+)"\s*\.\s*"((?:[^"]|"")+)"/i.exec(sql);
            const data = from ? rowsOf(unquote(from[1]), unquote(from[2])) : undefined;
            const conditions = [...sql.matchAll(/"((?:[^"]|"")+)"\s*=\s*\$(\d+)/g)].map(
              (match) => ({ column: unquote(match[1]), value: params[Number(match[2]) - 1] }),
            );
            const rows = (data?.rows ?? []).filter((row) =>
              conditions.every(({ column, value }) => String(row[column]) === value),
            );
            return {
              columns: data ? data.columns.map((column) => column.name) : [],
              rows,
              rows_affected: null,
              execution_time_ms: 1,
            };
          }
          case "get_database_overview":
            return {
              database: "shop",
              size_bytes: 48 * 1024 * 1024,
              size_pretty: "48 MB",
              schemas: [
                { schema: "sales", table_count: 2, size_bytes: 36 * 1024 * 1024 },
                { schema: "crm", table_count: 2, size_bytes: 12 * 1024 * 1024 },
              ],
            };
          case "ui_plugins_scan":
            return {
              dir: "/Users/demo/.l8db/ui",
              files: [...pluginFiles].map(([name, source]) => ({ name, source, modified: 0 })),
              skipped: [],
            };
          case "ui_plugins_write":
            pluginFiles.set(String(args.name), String(args.source));
            return null;
          case "ui_plugins_remove":
            pluginFiles.delete(String(args.name));
            return null;
          case "ui_plugins_write_support":
            written[String(args.name)] = String(args.contents);
            return null;
          case "plugin:event|listen": {
            const event = String(args.event);
            handlers.set(event, [...(handlers.get(event) ?? []), Number(args.handler)]);
            return handlers.get(event)?.length ?? 0;
          }
          default:
            return [];
        }
      };
      const emit = (event: string) => {
        for (const id of handlers.get(event) ?? []) {
          const callback = (window as unknown as Record<string, unknown>)[`_${id}`];
          if (typeof callback === "function") callback({ event, id: 1, payload: null });
        }
      };
      Object.assign(window, {
        __uiPluginDemo: {
          setPlugin: (name: string, source: string | null) => {
            if (source === null) pluginFiles.delete(name);
            else pluginFiles.set(name, source);
            emit("ui-plugins-changed");
          },
          written,
          calls,
        },
        __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => {} },
        __TAURI_INTERNALS__: {
          metadata: {
            currentWindow: { label: "main" },
            currentWebview: { windowLabel: "main", label: "main" },
          },
          transformCallback: (callback: unknown) => {
            const id = Math.floor(Math.random() * 1e9);
            Object.assign(window, { [`_${id}`]: callback });
            return id;
          },
          convertFileSrc: (path: string) => path,
          invoke,
        },
      });
      if (sessionStorage.getItem("ui-plugin-demo-seeded")) return;
      sessionStorage.setItem("ui-plugin-demo-seeded", "1");
      localStorage.setItem(
        "l8db.connections",
        JSON.stringify({
          state: {
            connections: [
              {
                id: "shop",
                name: "Shop Produktion",
                kind: "postgres",
                connectionString: "postgresql://demo@db.shop.example:5432/shop",
                sslMode: "require",
                environment,
                tags: [{ name: "crm", color: "#3b82f6" }],
              },
            ],
            activeId: "shop",
            favoriteServerKeys: [],
            serverOrder: [],
          },
          version: 0,
        }),
      );
      localStorage.setItem(
        "l8db.settings",
        JSON.stringify({
          state: { tourFinished: true, onboardingDone: true, ...settings },
          version: 0,
        }),
      );
      localStorage.setItem(
        "l8db.db-selection",
        JSON.stringify({
          state: { databaseByConnection: { shop: "shop" }, schemaByConnection: { shop: "sales" } },
          version: 0,
        }),
      );
      if (uiPlugins)
        localStorage.setItem("l8db.ui-plugins", JSON.stringify({ state: uiPlugins, version: 1 }));
      if (tabs.length)
        localStorage.setItem(
          "l8db.table-tabs",
          JSON.stringify({
            version: 4,
            state: {
              tabsByConnection: {
                shop: tabs.map((tab) => ({
                  kind: "table",
                  schema: tab.schema,
                  table: tab.table,
                  entityType: "table",
                })),
              },
              recentlyClosed: [],
            },
          }),
        );
    },
    {
      plugins,
      tabs: options.tabs ?? [],
      settings: options.settings ?? {},
      uiPlugins: options.uiPlugins ?? null,
      environment: options.environment === undefined ? "production" : options.environment,
    },
  );
}
