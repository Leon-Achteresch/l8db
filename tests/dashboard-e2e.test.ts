import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { chromium, type Locator } from "playwright";

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
  "Dashboard-Builder end-to-end gegen echte Postgres-Testdatenbank",
  async () => {
    const { mkdirSync } = await import("node:fs");
    mkdirSync("/tmp/l8db-dashboard-e2e", { recursive: true });
    const browser = await chromium.launch();
    const errors: string[] = [];
    let n = 0;
    try {
      const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
      page.on("pageerror", (e) => errors.push(e.message));
      await page.exposeFunction("__db", (cmd: string, args: Record<string, string>) => {
        try {
          return db(cmd, args);
        } catch (e) {
          return { __error: String(e) };
        }
      });
      await page.addInitScript(initScript);
      await page.goto(`${BASE}/dashboard`);
      await page.getByRole("button", { name: "Dashboard erstellen" }).click();

      const left = page.locator("body");
      const area = (name: string) =>
        page
          .getByRole("navigation", { name: "Arbeitsbereiche" })
          .getByRole("button", { name: new RegExp(name) });
      async function step(title: string) {
        const labels: Record<string, string> = {
          "Woher kommen die Daten?": "1. Quelle wählen",
          "Was möchtest du messen?": "2. Kennzahlen sammeln",
          "Wonach aufteilen?": "3. Gruppieren",
          Eingrenzen: "4. Filtern",
          "Sortierung und Anzahl": "5. Ergebnis begrenzen",
        };
        await page.getByRole("button", { name: labels[title], exact: true }).click();
        return left.locator("section").filter({ hasText: title });
      }
      async function pick(combobox: Locator, option: string) {
        await combobox.click();
        const esc = option.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        await page
          .getByRole("option", { name: new RegExp(`^${esc}(\\s|$)`) })
          .first()
          .click();
      }
      async function waitPreview() {
        await page.locator("text=/\\d+ Zeilen · \\d+ ms/").first().waitFor({ timeout: 15000 });
        const text = await page.locator("text=/\\d+ Zeilen · \\d+ ms/").first().textContent();
        return (text ?? "").trim();
      }
      async function newDataset(name: string, table = "orders") {
        await area("Daten.*Quellen").click();
        await page.getByRole("button", { name: "Datensatz hinzufügen", exact: true }).click();
        const nameInput = left.getByLabel("Name des Datensatzes");
        await nameInput.fill(name);
        await (await step("Woher kommen die Daten?"))
          .getByRole("button", { name: new RegExp(`^${table} public`) })
          .click();
      }
      async function setMetric(i: number, agg: string, column: string | null, label?: string) {
        const box = (await step("Was möchtest du messen?")).locator(".rounded-lg.border").nth(i);
        await pick(box.getByRole("combobox").nth(0), agg);
        if (column) await pick(box.getByRole("combobox").nth(1), column);
        if (label) await box.getByPlaceholder("Bezeichnung im Chart (optional)").fill(label);
      }
      async function addMetric() {
        await (await step("Was möchtest du messen?"))
          .getByRole("button", { name: "Weitere Kennzahl" })
          .click();
      }
      async function setDimension(col: string) {
        await pick((await step("Wonach aufteilen?")).getByRole("combobox").first(), col);
      }
      async function addChart(name: string) {
        await area("Charts.*Daten visualisieren").click();
        await page.getByRole("button", { name: "Chart hinzufügen", exact: true }).click();
        await left
          .getByRole("button", { name: new RegExp(`^${name}`) })
          .first()
          .click();
        await area("Daten.*Quellen").click();
      }

      await newDataset("Umsatz pro Monat");
      await pick(
        (await step("Woher kommen die Daten?")).getByRole("combobox").first(),
        "customers über customer_id",
      );
      await setMetric(0, "Summe", "amount", "Umsatz");
      await addMetric();
      await setMetric(1, "Summe", "sessions", "Sessions");
      await setDimension("created_at");
      await pick((await step("Eingrenzen")).getByRole("combobox").last(), "created_at");
      await (await step("Eingrenzen")).getByRole("button", { name: "Bedingung" }).click();
      const cond = (await step("Eingrenzen")).locator(".rounded-lg.border").first();
      await pick(cond.getByRole("combobox").nth(0), "customers.country");
      await cond.getByPlaceholder("Wert").fill("DE");
      console.log("D1 preview:", await waitPreview());
      await left.getByRole("button", { name: "Erzeugtes SQL" }).click();
      await page.screenshot({ path: "/tmp/l8db-dashboard-e2e/builder-d1.png" });
      await addChart("Verlauf");
      await addChart("Kennzahl");

      await newDataset("Nach Plan");
      await setDimension("plan");
      await pick(
        (await step("Sortierung und Anzahl")).getByRole("combobox").first(),
        "Größte Kennzahl zuerst",
      );
      console.log("D2 preview:", await waitPreview());
      for (const c of ["Pipeline", "Funnel", "Ringe", "Radar"]) await addChart(c);

      await newDataset("Sessions vs Umsatz");
      await setMetric(0, "Einzelwert (keine Zusammenfassung)", "sessions", "Sessions");
      await addMetric();
      await setMetric(1, "Einzelwert (keine Zusammenfassung)", "amount", "Revenue");
      await addMetric();
      await setMetric(2, "Einzelwert (keine Zusammenfassung)", "score", "Score");
      await setDimension("plan");
      console.log("D3 preview:", await waitPreview());
      await addChart("Blasen");

      await newDataset("Plan → Kanal");
      await setMetric(0, "Summe", "sessions", "Stunden");
      await setDimension("plan");
      await (await step("Wonach aufteilen?")).locator("summary").click();
      await pick((await step("Wonach aufteilen?")).getByRole("combobox").last(), "channel");
      console.log("D4 preview:", await waitPreview());
      await addChart("Fluss");

      await newDataset("Score");
      await setMetric(0, "Summe", "score", "Punkte");
      await addMetric();
      await setMetric(1, "Summe", "max_score", "Maximum");
      await setDimension("plan");
      await (await step("Sortierung und Anzahl")).getByRole("spinbutton").fill("3");
      console.log("D5 preview:", await waitPreview());
      await addChart("Score");

      await newDataset("View: Umsatz je Land", "v_orders");
      await setMetric(0, "Summe", "amount", "Umsatz");
      await addMetric();
      await setMetric(1, "Summe", "sessions", "Sessions");
      await setDimension("country");
      console.log("D6 preview:", await waitPreview());
      for (const c of ["Linien", "Säulen", "Donut", "Treemap", "Tabelle"]) await addChart(c);

      await newDataset("Zielerreichung");
      await setMetric(0, "Summe", "score", "Punkte");
      await addMetric();
      await setMetric(1, "Summe", "max_score", "Ziel");
      console.log("D7 preview:", await waitPreview());
      await addChart("Tacho");

      await pick(page.getByLabel("Datensatz auswählen"), "Plan → Kanal");
      await addChart("Heatmap");

      await area("Dashboard.*Anordnen").click();
      const firstCard = page.locator(".react-grid-item").first();
      await firstCard.getByRole("button", { name: "Widget-Einstellungen" }).click();
      const sheet = page.getByLabel("Chart bearbeiten", { exact: true });
      await sheet.getByRole("button", { name: /^2\s*Sessions$/ }).click();
      await sheet.getByRole("button", { name: "Farbe 3" }).click();
      await sheet.getByText("Legende anzeigen").locator("..").getByRole("switch").click();
      await sheet.getByRole("button", { name: "Linien", exact: true }).click();
      await page.screenshot({ path: "/tmp/l8db-dashboard-e2e/settings.png" });
      await page.keyboard.press("Escape");
      await page.waitForTimeout(500);
      const stored = await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("l8db-dashboards") ?? "{}").state.dashboards[0]
            .widgets[0],
      );
      console.log(
        "widget 1 after settings:",
        JSON.stringify({ chart: stored.chart, options: stored.options }),
      );
      expect(stored.chart).toBe("line");
      expect(stored.options.metricKeys).toEqual(["m0"]);
      expect(stored.options.colorOffset).toBe(2);
      expect(stored.options.showLegend).toBe(false);

      await area("Daten.*Quellen").click();
      await page.getByRole("button", { name: "Datensatz hinzufügen", exact: true }).click();
      await left.getByLabel("Name des Datensatzes").fill("Flow: Umsatz DE");
      await left.getByRole("tab", { name: "Beziehungen" }).click();
      const flowArea = left
        .locator("div.space-y-2\\.5")
        .filter({ has: page.locator(".react-flow") })
        .first();
      await pick(flowArea.getByRole("combobox").first(), "orders");
      await flowArea.getByRole("button", { name: /Verknüpfung/ }).click();
      await pick(flowArea.getByRole("combobox").first(), "customers über customer_id");
      await flowArea
        .getByRole("button", { name: /Bedingung/ })
        .first()
        .click();
      const condBox = flowArea.locator(".rounded-lg.border").first();
      await pick(condBox.getByRole("combobox").nth(0), "customers.country");
      await condBox.getByPlaceholder("Wert").fill("DE");
      await flowArea.getByRole("button", { name: /Gruppierung/ }).click();
      await pick(flowArea.getByRole("combobox").nth(0), "orders.created_at");
      const metricBox = flowArea.locator(".rounded-lg.border").first();
      await pick(metricBox.getByRole("combobox").nth(0), "Summe");
      await pick(metricBox.getByRole("combobox").nth(1), "orders.amount");
      await metricBox.getByPlaceholder("Bezeichnung im Chart (optional)").fill("Umsatz");
      await flowArea.getByRole("button", { name: /Sortierung/ }).click();
      await pick(flowArea.getByRole("combobox").first(), "Größte Kennzahl zuerst");
      console.log("D8 flow preview:", await waitPreview());
      for (let i = 0; i < 40 && !(log[log.length - 1]?.sql ?? "").includes("ORDER BY"); i++)
        await page.waitForTimeout(250);
      const flowSql = log[log.length - 1]?.sql ?? "";
      console.log("D8 flow SQL:", flowSql.replace(/\n/g, " "));
      expect(flowSql).toContain('LEFT JOIN "public"."customers" AS t2');
      expect(flowSql).toContain("t2.\"country\" = 'DE'");
      expect(flowSql).toContain("GROUP BY date_trunc('month', t1.\"created_at\")");
      expect(flowSql).toContain('ORDER BY "m0" DESC');
      console.log("flow nodes:", await flowArea.locator(".react-flow__node").count());
      expect(await flowArea.locator(".react-flow__node").count()).toBe(6);
      await page.screenshot({ path: "/tmp/l8db-dashboard-e2e/flow-builder.png" });
      await addChart("Säulen");

      await newDataset("Artikel je Auftrag");
      await pick(
        (await step("Woher kommen die Daten?")).getByRole("combobox").first(),
        "order_items (verweist über order_id)",
      );
      await (await step("Was möchtest du messen?"))
        .getByRole("button", { name: /Vorschlag: Anzahl order_items je orders/ })
        .click();
      await (await step("Sortierung und Anzahl")).getByRole("spinbutton").fill("10");
      console.log("D9 preview:", await waitPreview());
      for (let i = 0; i < 40 && !(log[log.length - 1]?.sql ?? "").includes("LIMIT 10"); i++)
        await page.waitForTimeout(250);
      const childSql = log[log.length - 1]?.sql ?? "";
      console.log("D9 SQL:", childSql.replace(/\n/g, " "));
      expect(childSql).toContain(
        'LEFT JOIN "public"."order_items" AS t2 ON t2."order_id" = t1."id"',
      );
      expect(childSql).toContain('COUNT(t2."order_id") AS "m0"');
      expect(childSql).toContain('GROUP BY t1."id"');
      expect(childSql).toContain('ORDER BY "m0" DESC');
      const childRows = log[log.length - 1]?.rows ?? 0;
      expect(childRows).toBe(10);
      await addChart("Säulen");

      await pick(page.getByLabel("Datensatz auswählen"), "Umsatz pro Monat");
      await left.getByRole("tab", { name: "SQL" }).click();
      await left.getByRole("button", { name: "Ausführen" }).click();
      console.log("Expert preview:", await waitPreview());
      await page.screenshot({ path: "/tmp/l8db-dashboard-e2e/builder-expert.png" });
      await left.getByRole("tab", { name: "Geführt" }).click();

      await area("Dashboard.*Anordnen").click();
      const first = page.locator(".react-grid-item").first();
      const before = log.length;
      await pick(first.getByRole("combobox").first(), "Letzte 90 Tage");
      await page.waitForTimeout(1500);
      console.log(
        "Period SQL:",
        log
          .slice(before)
          .map((l) => l.sql.split("\n").find((x) => x.startsWith("WHERE")))
          .join(" | "),
      );

      await page.waitForTimeout(2500);
      const items = page.locator(".react-grid-item");
      n = await items.count();
      console.log("widgets:", n);
      for (let i = 0; i < n; i++) {
        const item = items.nth(i);
        await item.scrollIntoViewIfNeeded();
        const text = await item.innerText();
        const title = text.split("\n")[0];
        const bad = /Fehler|Keine Daten|Braucht|Kein Datensatz/.test(text);
        const svgs = await item
          .locator("svg.recharts-surface, svg[role=img], .rounded-full.bg-muted, table")
          .count();
        console.log(`frame ${i + 1}: ${title} | visuals=${svgs}`);
        expect(bad, `Frame ${i + 1} (${title}): ${text.slice(0, 120)}`).toBe(false);
        expect(svgs).toBeGreaterThan(0);
        await item.screenshot({ path: `/tmp/l8db-dashboard-e2e/frame-${i + 1}.png` });
      }
      await page
        .locator(".workspace-canvas")
        .last()
        .evaluate((el) => (el.scrollTop = 0));
      await page.screenshot({ path: "/tmp/l8db-dashboard-e2e/full-top.png" });
      await page.screenshot({ path: "/tmp/l8db-dashboard-e2e/full-page.png", fullPage: true });
    } finally {
      await browser.close();
    }
    expect(log.filter((l) => l.error)).toEqual([]);
    expect(errors).toEqual([]);
    expect(n).toBe(18);
  },
  300_000,
);
