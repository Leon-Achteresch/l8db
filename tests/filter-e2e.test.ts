import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";

const PSQL = process.env.L8DB_PSQL ?? "/opt/homebrew/opt/postgresql@18/bin/psql";
const BASE = process.env.L8DB_FILTER_URL ?? "http://localhost:1420";
const DB = process.env.L8DB_FILTER_DB ?? "l8db_small";
type Row = Record<string, unknown>;
interface LogEntry {
  cmd: string;
  sql?: string;
  rows?: number;
  error?: string;
}

function rows(sql: string): Row[] {
  const out = execFileSync(
    PSQL,
    ["-d", DB, "-Atq", "-c", `select coalesce(json_agg(row_to_json(q)), '[]') from (${sql}) q`],
    { encoding: "utf8" },
  );
  return JSON.parse(out.trim() || "[]") as Row[];
}

const log: LogEntry[] = [];
const unknown = new Set<string>();

function db(cmd: string, args: Record<string, string>): unknown {
  const table = `"${args.schema}"."${args.table}"`;
  const where = args.filter ? ` where ${args.filter}` : "";
  switch (cmd) {
    case "list_providers":
      return [];
    case "list_databases":
      return [DB];
    case "list_schemas":
      return ["public"];
    case "list_views":
      return [];
    case "list_tables":
      return rows(
        "select table_schema as schema, table_name as name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by 2",
      );
    case "list_table_columns_detailed":
      return rows(
        `select column_name as name, data_type, is_nullable='YES' as is_nullable, column_default, column_name='id' as is_primary_key, ordinal_position, character_maximum_length from information_schema.columns where table_schema='${args.schema}' and table_name='${args.table}' order by ordinal_position`,
      );
    case "list_foreign_keys":
      return [];
    case "count_table_rows": {
      const sql = `select count(*)::int as n from ${table}${where}`;
      try {
        const n = rows(sql)[0].n as number;
        log.push({ cmd, sql, rows: n });
        return n;
      } catch (error) {
        log.push({ cmd, sql, error: String(error) });
        throw String(error);
      }
    }
    case "fetch_table_rows": {
      const order = args.orderBy
        ? ` order by "${args.orderBy}"${args.orderDesc ? " desc" : ""}`
        : " order by 1";
      const sql = `select ctid::text as __ctid__, * from ${table}${where}${order} limit ${args.limit ?? 100} offset ${args.offset ?? 0}`;
      try {
        const r = rows(sql);
        log.push({ cmd, sql, rows: r.length });
        return { columns: r.length ? Object.keys(r[0]) : [], rows: r };
      } catch (error) {
        log.push({ cmd, sql, error: String(error) });
        throw String(error);
      }
    }
    default:
      unknown.add(cmd);
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
localStorage.setItem("l8db.settings", JSON.stringify({ state: { tourFinished: true, onboardingDone: true }, version: 0 }));
localStorage.setItem("l8db.connections", JSON.stringify({ state: { connections: [{ id: "c1", name: "Filter-Test", kind: "postgres", connectionString: "postgres://leon@localhost/${DB}", sslMode: "disable" }], activeId: "c1", favoriteServerKeys: [], serverOrder: [] }, version: 0 }));
`;

test.skipIf(!process.env.L8DB_FILTER_E2E)(
  "table filter parses free-form SQL and matches case-insensitively on real Postgres",
  async () => {
    const browser = await chromium.launch();
    const errors: string[] = [];
    log.length = 0;
    try {
      const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
      page.on("pageerror", (error) => errors.push(error.message));
      await page.exposeFunction("__db", (cmd: string, args: Record<string, string>) => {
        try {
          return db(cmd, args);
        } catch (error) {
          return { __error: String(error) };
        }
      });
      await page.addInitScript(initScript);
      await page.goto(`${BASE}/tables/public/kunde`);
      await page.getByText("k1", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Filter", exact: true }).click();
      const editor = page.locator(".monaco-editor .view-lines");
      const apply = page.getByRole("button", { name: "Filter anwenden", exact: true });
      const run = async (expression: string) => {
        await page.getByRole("tab", { name: "SQL", exact: true }).click();
        await editor.click();
        await page.keyboard.press("ControlOrMeta+a");
        await page.keyboard.insertText(expression);
        await page.getByRole("tab", { name: "Einfach", exact: true }).click();
        const alerts = await page.getByRole("alert").allTextContents();
        expect(alerts.filter(Boolean)).toEqual([]);
        const before = log.length;
        await apply.click();
        for (let i = 0; i < 50; i++) {
          await page.waitForTimeout(100);
          const fetch = log.slice(before).find((entry) => entry.cmd === "fetch_table_rows");
          if (fetch) {
            await page.waitForTimeout(300);
            return fetch;
          }
        }
        throw new Error(`no fetch after applying ${expression}`);
      };

      let fetch = await run("name = 'K7'");
      expect(fetch.error).toBeUndefined();
      expect(fetch.sql).toContain(`"name"::text ILIKE 'K7' ESCAPE '!'`);
      expect(fetch.rows).toBe(1);
      await page.getByText("k7", { exact: true }).waitFor();
      expect(await page.getByText("k70", { exact: true }).count()).toBe(0);

      fetch = await run("name like '%K49%' and id between 1 and 495");
      expect(fetch.error).toBeUndefined();
      expect(fetch.rows).toBe(
        rows("select 1 from kunde where name ilike '%k49%' and id between 1 and 495").length,
      );

      fetch = await run("name in (K3, 'K4') or id = 5");
      expect(fetch.error).toBeUndefined();
      expect(fetch.rows).toBe(3);

      fetch = await run("name <> 'k1' and name is not null");
      expect(fetch.error).toBeUndefined();
      expect(fetch.rows).toBe(100);
      expect(log.findLast((entry) => entry.cmd === "count_table_rows")?.rows).toBe(499);
      if (process.env.L8DB_FILTER_SCREENSHOT)
        await page.screenshot({ path: process.env.L8DB_FILTER_SCREENSHOT });
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
    }
    if (unknown.size) console.log("unhandled commands:", [...unknown].join(", "));
  },
  60_000,
);
