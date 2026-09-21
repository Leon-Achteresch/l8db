import { expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const PSQL = process.env.L8DB_PSQL ?? "/opt/homebrew/opt/postgresql@18/bin/psql";
const BASE = process.env.L8DB_DASH_URL ?? "http://localhost:1420";
const DB = process.env.L8DB_DASH_DB ?? "l8db_dash";
const BIN = process.env.L8DB_BIN ?? `${import.meta.dir}/../src-tauri/target/debug/l8db`;
const DIR = join(tmpdir(), `l8db-mcp-dash-${process.pid}`);
const BOARDS = join(DIR, "mcp-dashboards");

type Row = Record<string, unknown>;

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

function mcp(...calls: Record<string, unknown>[]): { ok: boolean; text: string }[] {
  const lines = [
    { jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18" } },
    ...calls.map((args, i) => ({
      jsonrpc: "2.0",
      id: i + 1,
      method: "tools/call",
      params: { name: "dashboard", arguments: args },
    })),
  ];
  const run = spawnSync(BIN, ["--mcp"], {
    input: `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`,
    env: { ...process.env, L8DB_MCP_CONFIG: join(DIR, "mcp.json") },
    encoding: "utf8",
  });
  return run.stdout
    .trim()
    .split("\n")
    .slice(1)
    .map((line) => {
      const result = JSON.parse(line).result;
      return { ok: !result.isError, text: result.content[0].text as string };
    });
}

function boardFiles(): Row[] {
  return readdirSync(BOARDS)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const text = readFileSync(join(BOARDS, f), "utf8");
      return { ...JSON.parse(text), stamp: createHash("sha1").update(text).digest("hex") };
    });
}

const sqlLog: { sql: string; error?: string }[] = [];

function backend(cmd: string, args: Record<string, unknown>): unknown {
  switch (cmd) {
    case "mcp_dashboards":
      return boardFiles();
    case "mcp_dashboard_save": {
      const board = args.dashboard as Row;
      const text = `${JSON.stringify({ ...board, createdAt: 1 }, null, 2)}\n`;
      writeFileSync(join(BOARDS, `${board.id}.json`), text);
      return createHash("sha1").update(text).digest("hex");
    }
    case "mcp_dashboard_delete":
      rmSync(join(BOARDS, `${args.id}.json`), { force: true });
      return null;
    case "list_providers":
      return [];
    case "list_databases":
      return [DB];
    case "list_schemas":
      return ["public"];
    case "execute_query": {
      const sql = String(args.sql);
      try {
        const result = rows(sql);
        sqlLog.push({ sql });
        return {
          columns: result.length ? Object.keys(result[0]) : [],
          rows: result,
          rows_affected: null,
          execution_time_ms: 1,
        };
      } catch (error) {
        const message = String((error as { stderr?: unknown }).stderr ?? error);
        sqlLog.push({ sql, error: message });
        return { __error: message };
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
localStorage.setItem("l8db.settings", JSON.stringify({ state: { tourFinished: true, onboardingDone: true }, version: 0 }));
localStorage.setItem("l8db.connections", JSON.stringify({ state: { connections: [{ id: "c1", name: "Dash-Test", kind: "postgres", connectionString: "postgres://leon@localhost/${DB}", sslMode: "disable" }], activeId: "c1", favoriteServerKeys: [], serverOrder: [] }, version: 0 }));
`;

const CHARTS = [
  {
    type: "kpi",
    title: "Umsatz",
    sql: "SELECT date_trunc('month', created_at)::date AS monat, SUM(amount) AS umsatz FROM orders GROUP BY 1 ORDER BY 1",
    dimension: "monat",
    metrics: ["umsatz"],
    dateColumn: "monat",
  },
  {
    type: "gauge",
    title: "Score",
    sql: "SELECT SUM(score) AS erreicht, SUM(max_score) AS maximum FROM orders",
    metrics: ["erreicht", "maximum"],
  },
  {
    type: "area",
    title: "Verlauf",
    sql: "SELECT date_trunc('week', created_at)::date AS woche, plan, SUM(amount) AS umsatz FROM orders GROUP BY 1, 2 ORDER BY 1",
    dimension: "woche",
    dimension2: "plan",
    metrics: ["umsatz"],
    dateColumn: "woche",
    period: "90d",
  },
  {
    type: "donut",
    title: "Kanäle",
    sql: "SELECT channel, COUNT(*) AS n FROM orders GROUP BY 1",
    dimension: "channel",
    metrics: ["n"],
  },
  {
    type: "bars",
    title: "Länder",
    sql: "SELECT c.country, SUM(o.amount) AS umsatz FROM orders o JOIN customers c ON c.id = o.customer_id GROUP BY 1 ORDER BY 2 DESC",
    dimension: "country",
    metrics: ["umsatz"],
  },
  {
    type: "heatmap",
    title: "Matrix",
    sql: "SELECT plan, channel, COUNT(*) AS n FROM orders GROUP BY 1, 2",
    dimension: "plan",
    dimension2: "channel",
    metrics: ["n"],
    options: { labels: true },
  },
  {
    type: "sankey",
    title: "Fluss",
    sql: "SELECT channel, plan, COUNT(*) AS n FROM orders GROUP BY 1, 2",
    dimension: "channel",
    dimension2: "plan",
    metrics: ["n"],
  },
  {
    type: "score",
    title: "Score je Plan",
    sql: "SELECT plan, SUM(score) AS punkte, SUM(max_score) AS max FROM orders GROUP BY 1",
    dimension: "plan",
    metrics: ["punkte", "max"],
  },
  {
    type: "table",
    title: "Neueste",
    sql: "SELECT id, plan, amount FROM orders ORDER BY created_at DESC LIMIT 5",
    w: 12,
    h: 6,
  },
];

test.skipIf(!process.env.L8DB_MCP_DASH_E2E)(
  "dashboards built over MCP render live in the app and sync back",
  async () => {
    rmSync(DIR, { recursive: true, force: true });
    mkdirSync(BOARDS, { recursive: true });
    writeFileSync(
      join(DIR, "mcp.json"),
      JSON.stringify({
        enabled: true,
        connections: [
          {
            id: "c1",
            name: "Dash-Test",
            kind: "postgres",
            connectionString: `postgres://leon@localhost:5432/${DB}?sslmode=disable`,
            exposed: true,
            readOnly: true,
          },
        ],
      }),
    );
    const [created] = mcp({
      action: "create",
      connection: "Dash-Test",
      name: "MCP Cockpit",
      charts: CHARTS,
    });
    expect(created.ok).toBe(true);

    const browser = await chromium.launch();
    const errors: string[] = [];
    try {
      const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
      page.on("pageerror", (error) => errors.push(error.message));
      await page.exposeFunction("__db", (cmd: string, args: Record<string, unknown>) => {
        try {
          return backend(cmd, args);
        } catch (error) {
          return { __error: String(error) };
        }
      });
      await page.addInitScript(initScript);
      await page.goto(`${BASE}/dashboard`);
      await page.getByRole("heading", { name: "MCP Cockpit" }).waitFor();
      await expect(page.getByText("MCP", { exact: true }).isVisible()).resolves.toBe(true);
      const cards = page.locator(".react-grid-item");
      await page.waitForFunction(
        (n) =>
          document.querySelectorAll(".react-grid-item").length === n &&
          !document.querySelector('.react-grid-item [data-slot="skeleton"]'),
        CHARTS.length,
      );
      expect(await cards.count()).toBe(CHARTS.length);
      for (const chart of CHARTS)
        await expect(cards.getByText(chart.title, { exact: true }).count()).resolves.toBe(1);
      await expect(page.getByRole("alert").count()).resolves.toBe(0);
      await expect(page.getByText(/^Braucht|Kein Datensatz|Keine Daten/).count()).resolves.toBe(0);
      expect(await page.locator(".react-grid-item svg").count()).toBeGreaterThan(6);
      expect(sqlLog.filter((entry) => entry.error)).toEqual([]);
      expect(
        sqlLog.some((entry) => /WHERE q\."woche" >= '\d{4}-\d{2}-\d{2}'/.test(entry.sql)),
      ).toBe(true);
      await page.screenshot({ path: "/tmp/l8db-mcp-dashboard.png", fullPage: true });

      const [added] = mcp(
        {
          action: "add_charts",
          dashboard: "MCP Cockpit",
          charts: [
            {
              type: "funnel",
              title: "Funnel live",
              sql: "SELECT plan, COUNT(*) AS n FROM orders GROUP BY 1 ORDER BY 2 DESC",
              dimension: "plan",
              metrics: ["n"],
            },
          ],
        },
        { action: "update", dashboard: "MCP Cockpit", name: "MCP Cockpit v2" },
      );
      expect(added.ok).toBe(true);
      await page.getByRole("heading", { name: "MCP Cockpit v2" }).waitFor({ timeout: 6000 });
      await cards.getByText("Funnel live", { exact: true }).waitFor();
      expect(await cards.count()).toBe(CHARTS.length + 1);

      await page.getByRole("button", { name: "Dashboard bearbeiten" }).click();
      await page.getByLabel("Dashboard-Name").fill("Vom Nutzer umbenannt");
      await page.getByRole("button", { name: "Zur Ansicht wechseln" }).click();
      await page.waitForTimeout(800);
      const [got] = mcp({ action: "get", dashboard: "Vom Nutzer umbenannt" });
      expect(got.ok).toBe(true);
      expect(JSON.parse(got.text).charts).toHaveLength(CHARTS.length + 1);

      const [removed] = mcp({ action: "delete", dashboard: "Vom Nutzer umbenannt" });
      expect(removed.ok).toBe(true);
      await page.getByText("Noch kein Dashboard für Dash-Test").waitFor({ timeout: 6000 });
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
      rmSync(DIR, { recursive: true, force: true });
    }
  },
  90_000,
);
