import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { chromium, webkit } from "playwright";
import config from "../src-tauri/tauri.conf.json";
import { seedApp } from "./fixtures/perf-app";

test.skipIf(!process.env.L8DB_QOL_BROWSER)("QoL dialogs: destructive confirmation, paste review, full XLSX worker and task results", async () => {
  const root = resolve("dist");
  const policy = Object.entries(config.app.security.csp).map(([name, value]) => `${name} ${value}`).join("; ");
  const server = Bun.serve({ port: 0, async fetch(request) {
    const path = resolve(root, `.${new URL(request.url).pathname}`);
    if (!path.startsWith(`${root}/`) && path !== root) return new Response(null, { status: 403 });
    if (path !== root && await Bun.file(path).exists()) return new Response(Bun.file(path));
    return new Response(Bun.file(resolve(root, "index.html")), { headers: { "Content-Type": "text/html", "Content-Security-Policy": policy } });
  } });
  const browser = await (process.env.L8DB_QOL_BROWSER === "webkit" ? webkit : chromium).launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await seedApp(page, 2, { rows: 2, columns: 2 });
    await page.addInitScript(() => {
      const host = window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args?: unknown, options?: unknown) => Promise<unknown> }; qolCalls: { command: string; args: unknown }[]; xlsxBytes: number[] };
      const original = host.__TAURI_INTERNALS__.invoke;
      host.qolCalls = [];
      host.xlsxBytes = [];
      host.__TAURI_INTERNALS__.invoke = async (command, input, options) => {
        host.qolCalls.push({ command, args: input });
        const args = (input ?? {}) as Record<string, unknown>;
        if (command === "list_import_columns") return [{ name: "id", data_type: "integer", is_nullable: false, has_default: false, is_identity: false, is_generated: false }, { name: "col_1", data_type: "text", is_nullable: true, has_default: false, is_identity: false, is_generated: false }];
        if (command === "begin_transaction") return "qol-ui-tx";
        if (command === "insert_row_in_transaction") return args.values;
        if (command === "execute_in_transaction") return { columns: [], rows: [], rows_affected: 1, execution_time_ms: 1 };
        if (command === "fetch_table_rows" && args.limit === 2000) return { columns: ["id", "col_1"], rows: Number(args.offset ?? 0) === 0 ? [{ id: 1, col_1: "one" }, { id: 2, col_1: "two" }, { id: 3, col_1: "third-unloaded-row" }] : [] };
        if (command === "plugin:dialog|save") return "/tmp/qol-browser.xlsx";
        if (command === "plugin:fs|write_file") { host.xlsxBytes = Array.from(input as Uint8Array); return; }
        return original(command, input, options);
      };
      localStorage.setItem("l8db.table-tabs", JSON.stringify({ version: 4, state: { tabsByConnection: { perf: [{ kind: "query", id: "qol-ui", title: "QoL", sql: "DELETE FROM table_0000" }] }, recentlyClosed: [] } }));
    });
    await page.goto(`http://localhost:${server.port}/query/qol-ui`);
    await page.getByRole("button", { name: "Ausführen", exact: true }).first().click();
    await page.getByRole("heading", { name: "Destruktive Abfrage ausführen?" }).waitFor();
    expect(await page.evaluate(() => (window as unknown as { qolCalls: { command: string }[] }).qolCalls.filter((call) => call.command === "execute_query" || call.command === "execute_in_transaction").length)).toBe(0);
    await page.getByRole("button", { name: "Abbrechen", exact: true }).click();
    await page.goto(`http://localhost:${server.port}/tables/public/table_0000`);
    await page.getByRole("button", { name: "Tabellenblock einfügen", exact: true }).click();
    await page.getByRole("textbox", { name: "Tabellenblock", exact: true }).fill("id\tcol_1\n11\talpha\n12\tbeta");
    await page.getByRole("button", { name: "In Transaktion einfügen", exact: true }).click();
    await page.getByRole("heading", { name: "Tabellenblock einfügen", exact: true }).waitFor({ state: "hidden" });
    const inserted = await page.evaluate(() => (window as unknown as { qolCalls: { command: string; args: Record<string, unknown> }[] }).qolCalls.filter((call) => call.command === "insert_row_in_transaction"));
    expect(inserted).toHaveLength(2);
    expect(inserted[0].args.values).toEqual({ id: "11", col_1: "alpha" });
    expect(inserted[1].args.txId).toBe("qol-ui-tx");
    expect(await page.evaluate(() => (window as unknown as { qolCalls: { command: string }[] }).qolCalls.some((call) => call.command === "commit_transaction"))).toBe(false);
    await page.getByRole("button", { name: "Export", exact: true }).click();
    await page.getByRole("menuitem", { name: "Als XLSX exportieren…", exact: true }).click();
    await page.getByText("Alle gefilterten Zeilen exportieren", { exact: true }).click();
    await page.getByRole("button", { name: "Exportieren", exact: true }).click();
    await page.waitForFunction(() => (window as unknown as { xlsxBytes: number[] }).xlsxBytes.length > 0);
    const bytes = await page.evaluate(() => (window as unknown as { xlsxBytes: number[] }).xlsxBytes);
    expect(new TextDecoder().decode(Uint8Array.from(bytes))).toContain("third-unloaded-row");
    await page.getByRole("button", { name: /^Aufgaben/ }).click();
    await page.getByRole("heading", { name: "Aufgaben", exact: true }).waitFor();
    expect(await page.getByText("XLSX-Export", { exact: true }).count()).toBe(1);
    expect(await page.getByText("Tabellenblock einfügen · public.table_0000", { exact: true }).count()).toBe(1);
    await page.waitForTimeout(500);
    await page.screenshot({ path: "/tmp/l8db-qol-tasks.png" });
    expect(errors).toEqual([]);
  } finally { await browser.close(); server.stop(true); }
}, 60000);
