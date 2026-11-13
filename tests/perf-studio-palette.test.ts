import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { chromium, type Page } from "playwright";
import { reportScenario } from "../scripts/performance-report";
import { seedApp } from "./fixtures/perf-app";
import { seedSupabaseStudio } from "./fixtures/supabase-studio-mock";

const CONVEX_TABLES = 1000;
const OPEN_RUNS = 9;
const OPEN_MEDIAN_MS = Number(process.env.L8DB_STUDIO_PALETTE_MEDIAN_MS ?? 100);
const OPEN_P95_MS = Number(process.env.L8DB_STUDIO_PALETTE_P95_MS ?? 250);
const DATABASE_READS = ["list_tables", "list_views", "list_functions", "list_procedures"];

type MockWindow = {
  __calls: string[];
  __databaseInvoke: Invoke;
  __TAURI_INTERNALS__: { invoke: Invoke };
};
type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

function serveApplication() {
  const dist = resolve(process.env.L8DB_PERF_DIST ?? "dist");
  return Bun.serve({
    port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname;
      const asset = Bun.file(resolve(dist, path.slice(1)));
      return new Response(
        path !== "/" && (await asset.exists()) ? asset : Bun.file(resolve(dist, "index.html")),
      );
    },
  });
}

async function calls(page: Page, commands: string[]) {
  return page.evaluate(
    (commands) =>
      (window as unknown as MockWindow).__calls.filter((command) => commands.includes(command))
        .length,
    commands,
  );
}

async function hotkey(page: Page) {
  return page.evaluate(() =>
    /mac/i.test(`${navigator.platform} ${navigator.userAgent}`) ? "Meta+p" : "Control+p",
  );
}

async function search(page: Page, query: string, name = query) {
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await palette.getByRole("combobox").fill(query);
  await page.waitForTimeout(250);
  return palette.getByRole("option").filter({ hasText: new RegExp(`^${name}`) });
}

test.skipIf(!process.env.L8DB_PERF_APP)(
  "Strg+P sucht im Convex Studio in den Convex-Tabellen statt in der letzten Datenbankverbindung",
  async () => {
    const server = serveApplication();
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await seedApp(page, 400);
      await page.addInitScript((count) => {
        const state = window as unknown as MockWindow;
        const invoke = state.__TAURI_INTERNALS__.invoke;
        const tables = Array.from({ length: count }, (_, index) => ({
          name: `convex_${String(index).padStart(4, "0")}`,
          documents: index,
        }));
        state.__calls = [];
        state.__TAURI_INTERNALS__.invoke = async (command, args) => {
          state.__calls.push(command);
          if (command === "convex_profiles")
            return [{ id: "self", team_id: 0, url: "http://127.0.0.1:3210" }];
          if (command === "convex_studio_data_tables") return { tables, has_more: false };
          if (command === "convex_studio_data_documents")
            return { documents: [], cursor: null, has_more: false };
          if (command === "convex_studio_data_schema")
            return { has_schema: false, schema_validation: false, tables: [], indexes: [] };
          return invoke(command, args);
        };
      }, CONVEX_TABLES);

      await page.goto(`http://localhost:${server.port}/`);
      await page.locator('a[data-name="table_0000"]').waitFor();
      await page.goto(`http://localhost:${server.port}/baas?provider=convex&studio=data`);
      const sidebar = page.locator("[data-baas-studio] > aside");
      await sidebar.getByText("convex_0000", { exact: true }).waitFor();
      await page.waitForTimeout(500);
      const key = await hotkey(page);
      const palette = page.getByRole("dialog", { name: "Command palette" });
      const readsBefore = await calls(page, DATABASE_READS);

      const samples: number[] = [];
      for (let run = 0; run < OPEN_RUNS; run++) {
        const started = performance.now();
        await page.keyboard.press(key);
        await palette.getByRole("option").first().waitFor();
        if (run > 0) samples.push(performance.now() - started);
        expect(await palette.getByRole("option").count()).toBeLessThanOrEqual(60);
        await page.keyboard.press("Escape");
        await palette.waitFor({ state: "hidden" });
      }
      samples.sort((a, b) => a - b);
      const median = samples[Math.floor(samples.length / 2)];
      const p95 = samples[Math.ceil(samples.length * 0.95) - 1];

      await page.keyboard.press(key);
      await (await search(page, "convex_0942")).first().waitFor();
      expect(await palette.getByRole("option").count()).toBeLessThanOrEqual(60);
      expect(await (await search(page, "table_0000")).count()).toBe(0);
      expect(await calls(page, DATABASE_READS)).toBe(readsBefore);
      expect(await calls(page, ["search_columns", "search_source"])).toBe(0);
      expect(await calls(page, ["convex_studio_data_tables"])).toBe(1);

      await search(page, "convex_0942");
      await page.keyboard.press("Enter");
      await page.waitForURL(/table=convex_0942/);
      await sidebar.locator('button[aria-pressed="true"]', { hasText: "convex_0942" }).waitFor();

      await page.keyboard.press(key);
      await (await search(page, "> Umgebung", "Umgebung")).first().waitFor();
      await page.keyboard.press("Enter");
      await page.waitForURL(/studio=environment/);

      const idleBefore = await page.evaluate(
        () => (window as unknown as MockWindow).__calls.length,
      );
      await page.waitForTimeout(1500);
      const idleCalls = await page.evaluate(
        (from) =>
          (window as unknown as MockWindow).__calls
            .slice(from)
            .filter(
              (command) => command.startsWith("convex_studio_data") || /^list_/.test(command),
            ),
        idleBefore,
      );
      expect(idleCalls).toEqual([]);

      await page.goto(`http://localhost:${server.port}/`);
      await page.locator('a[data-name="table_0000"]').waitFor();
      await page.keyboard.press(key);
      await (await search(page, "table_0000")).first().waitFor();
      expect(await (await search(page, "convex_0942")).count()).toBe(0);

      expect(errors).toEqual([]);
      expect(median).toBeLessThan(OPEN_MEDIAN_MS);
      expect(p95).toBeLessThan(OPEN_P95_MS);
      await reportScenario("studio-palette-convex", {
        convexTables: CONVEX_TABLES,
        databaseTables: 400,
        runs: samples.length,
        medianMs: median,
        p95Ms: p95,
        databaseReadsWhileOpen: 0,
        convexTableReads: 1,
        maxOptions: 60,
      });
    } finally {
      await browser.close();
      await server.stop(true);
    }
  },
  120_000,
);

test.skipIf(!process.env.L8DB_PERF_APP)(
  "Strg+P sucht im Supabase Studio in den Projekttabellen statt in der letzten Datenbankverbindung",
  async () => {
    const server = serveApplication();
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await seedApp(page, 400);
      await page.addInitScript(() => {
        const state = window as unknown as MockWindow;
        state.__databaseInvoke = state.__TAURI_INTERNALS__.invoke;
      });
      await seedSupabaseStudio(page);
      await page.addInitScript(() => {
        const state = window as unknown as MockWindow;
        const studio = state.__TAURI_INTERNALS__.invoke;
        state.__calls = [];
        state.__TAURI_INTERNALS__.invoke = async (command, args) => {
          state.__calls.push(command);
          return command.startsWith("supabase") || command.endsWith("_profiles")
            ? studio(command, args)
            : state.__databaseInvoke(command, args);
        };
      });

      await page.goto(`http://localhost:${server.port}/baas?provider=supabase&studio=overview`);
      await page.locator("section[aria-label='Übersicht']").waitFor();
      await page.waitForTimeout(800);
      const key = await hotkey(page);
      const readsBefore = await calls(page, DATABASE_READS);
      const listsBefore = await calls(page, ["supabase_studio_tables_list"]);

      await page.keyboard.press(key);
      await (await search(page, "storage.buckets", "buckets")).first().waitFor();
      expect(await (await search(page, "table_0000")).count()).toBe(0);
      expect(await calls(page, DATABASE_READS)).toBe(readsBefore);
      const palettePages = (await calls(page, ["supabase_studio_tables_list"])) - listsBefore;
      expect(palettePages).toBeGreaterThanOrEqual(1);
      expect(palettePages).toBeLessThanOrEqual(5);

      await page.keyboard.press("Escape");
      await page.keyboard.press(key);
      const orders = await search(page, "orders");
      expect((await calls(page, ["supabase_studio_tables_list"])) - listsBefore).toBe(palettePages);
      await orders.first().click();
      await page.waitForURL(/studio=tables/);
      expect(page.url()).toContain("table=orders");
      await page.getByRole("tab", { name: "Spalten" }).waitFor();

      expect(errors).toEqual([]);
      await reportScenario("studio-palette-supabase", {
        databaseTables: 400,
        tableListRequests: palettePages,
        databaseReadsWhileOpen: 0,
      });
    } finally {
      await browser.close();
      await server.stop(true);
    }
  },
  120_000,
);
