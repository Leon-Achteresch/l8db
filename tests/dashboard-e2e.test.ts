import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";

const PSQL = process.env.L8DB_PSQL ?? "/opt/homebrew/opt/postgresql@18/bin/psql";
const BASE = process.env.L8DB_DASH_URL ?? "http://localhost:1420";
const DB = process.env.L8DB_DASH_DB ?? "l8db_dash";
type Row = Record<string, unknown>;
interface LogEntry {
  sql: string;
  rows?: number;
  error?: string;
}
function errorText(e: unknown): string {
  if (e && typeof e === "object" && "stderr" in e && (e as { stderr?: unknown }).stderr)
    return String((e as { stderr: unknown }).stderr);
  return e instanceof Error ? e.message : String(e);
}
function rows(sql: string): Row[] {
  const out = execFileSync(
    PSQL,
    [
      "-d",
      DB,
      "-Atq",
      "-c",
      `select coalesce(json_agg(row_to_json(q)), '[]') from (${sql.replace(/;\s*$/, "")}) q`,
    ],
    { encoding: "utf8" },
  );
  return JSON.parse(out.trim() || "[]") as Row[];
}
const log: LogEntry[] = [];
function db(cmd: string, args: Record<string, string>): unknown {
  switch (cmd) {
    case "list_providers":
      return [];
    case "list_databases":
      return [DB];
    case "list_views":
      return rows(
        "select table_schema as schema, table_name as name from information_schema.views where table_schema='public' order by 2",
      );
    case "get_er_schema":
      return {
        tables: [],
        foreign_keys: rows(
          "select c.conname as constraint_name, 'public' as from_schema, c.conrelid::regclass::text as from_table, a.attname as from_column, 'public' as to_schema, c.confrelid::regclass::text as to_table, b.attname as to_column from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1] join pg_attribute b on b.attrelid=c.confrelid and b.attnum=c.confkey[1] where c.contype='f'",
        ),
      };
    case "list_schemas":
      return ["public"];
    case "list_tables":
      return rows(
        "select table_schema as schema, table_name as name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by 2",
      );
    case "list_table_columns_detailed":
      return rows(
        `select column_name as name, data_type, is_nullable='YES' as is_nullable, column_default, false as is_primary_key, ordinal_position, character_maximum_length from information_schema.columns where table_schema='${args.schema}' and table_name='${args.table}' order by ordinal_position`,
      );
    case "list_foreign_keys":
      return rows(
        `select c.conname as constraint_name, 'public' as from_schema, c.conrelid::regclass::text as from_table, a.attname as from_column, 'public' as to_schema, c.confrelid::regclass::text as to_table, b.attname as to_column from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1] join pg_attribute b on b.attrelid=c.confrelid and b.attnum=c.confkey[1] where c.contype='f' and c.conrelid::regclass::text='${args.table}'`,
      );
    case "execute_query": {
      const t = Date.now();
      try {
        const r = rows(args.sql);
        log.push({ sql: args.sql, rows: r.length });
        return {
          columns: r.length ? Object.keys(r[0]) : [],
          rows: r,
          rows_affected: null,
          execution_time_ms: Date.now() - t,
        };
      } catch (e) {
        log.push({ sql: args.sql, error: errorText(e) });
        throw errorText(e);
      }
    }
    default:
      return null;
  }
}

const initScript = `
window.__TAURI_INTERNALS__ = {
  metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main", windowLabel: "main" }, windows: [{label:"main"}], webviews: [{label:"main", windowLabel:"main"}] },
  transformCallback: (cb) => { const id = Math.floor(Math.random()*1e9); window["_" + id] = cb; return id; },
  convertFileSrc: (p) => p, plugins: {},
  invoke: async (cmd, args) => { const r = await window.__db(cmd, args ?? {}); if (r && r.__error) throw r.__error; return r; }
};
window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
localStorage.setItem("l8db.settings", JSON.stringify({ state: { tourFinished: true }, version: 0 }));
localStorage.setItem("l8db.connections", JSON.stringify({ state: { connections: [{ id: "c1", name: "Dash-Test", kind: "postgres", connectionString: "postgres://leon@localhost/${DB}", sslMode: "disable" }], activeId: "c1", favoriteServerKeys: [], serverOrder: [] }, version: 0 }));
`;

test.skipIf(!process.env.L8DB_DASH_E2E)(
  "Chart worksheet executes real Postgres aggregation and filters",
  async () => {
    const browser = await chromium.launch();
    const errors: string[] = [];
    log.length = 0;
    try {
      const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
      page.on("pageerror", (error) => errors.push(error.message));
      await page.exposeFunction("__db", (cmd: string, args: Record<string, string>) => {
        try {
          return db(cmd, args);
        } catch (error) {
          return { __error: String(error) };
        }
      });
      await page.addInitScript(initScript);
      await page.goto(`${BASE}/dashboard`);
      await page.getByRole("button", { name: "Dashboard erstellen", exact: true }).click();
      await page.getByRole("button", { name: "Ersten Chart hinzufügen", exact: true }).click();
      await page.getByLabel("Datenquelle", { exact: true }).click();
      await page.getByRole("option", { name: /^orders / }).click();
      const field = (name: string) => page.locator(`[data-worksheet-field="${name}"]`);
      const shelf = (name: string) => page.locator(`[data-field-shelf^="${name}"]`);
      await field("amount").dragTo(shelf("Zeilen"));
      await field("created_at").dragTo(shelf("Spalten"));
      await field("channel").dragTo(shelf("Farbe"));
      await page.locator(".recharts-surface").first().waitFor();
      await field("amount").dragTo(shelf("Filter"));
      await page.getByLabel("Filter von", { exact: true }).fill("100");
      await page.getByLabel("Filter bis", { exact: true }).fill("1000");
      await page.getByRole("button", { name: "Filter anwenden" }).click();
      await page.getByRole("button", { name: "Summe · amount einstellen", exact: true }).click();
      await page.getByLabel("Berechnung amount", { exact: true }).click();
      await page.getByRole("option", { name: "Durchschnitt", exact: true }).click();
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => !document.querySelector('[data-slot="skeleton"]'));
      await page.waitForTimeout(700);
      const filtered = log.filter(
        (entry) =>
          entry.sql.includes("AVG(") && entry.sql.includes(">=") && entry.sql.includes("<="),
      );
      expect(filtered.length).toBeGreaterThan(0);
      expect(filtered.at(-1)?.rows).toBeGreaterThan(0);
      expect(filtered.at(-1)?.sql).toContain("date_trunc('month'");
      expect(filtered.at(-1)?.sql).toContain('"channel"');
      await page.getByRole("button", { name: "Gespeicherte Charts", exact: true }).click();
      const drawer = page.getByRole("dialog", { name: "Gespeicherte Charts", exact: true });
      await drawer.getByRole("button", { name: "Chart speichern", exact: true }).click();
      await drawer.getByRole("button", { name: "Ins Dashboard laden", exact: true }).click();
      await page.locator(".recharts-surface").first().waitFor();
      await page.getByRole("button", { name: "Zum Dashboard →", exact: true }).click();
      expect(await page.locator(".react-grid-item").count()).toBe(2);
      await page.waitForTimeout(500);
      expect(log.filter((entry) => entry.error)).toEqual([]);
      expect(errors).toEqual([]);
      await page.screenshot({ path: "/tmp/l8db-real-postgres-dashboard.png" });
    } finally {
      await browser.close();
    }
  },
  60000,
);
