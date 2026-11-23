import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { type Browser, chromium, type Page } from "playwright";
import { interactionPercentiles, measureAppClick } from "./fixtures/perf-app-interactions";

const url = process.env.L8DB_TABLE_BROWSER_URL;
const run = url ? test : test.skip;
const optional = [
  "list_all_columns",
  "list_functions",
  "list_materialized_views",
  "list_procedures",
  "list_tables",
  "list_views",
];
const mandatory = ["get_table_rls", "list_databases", "list_foreign_keys", "list_schemas"];
type Call = { command: string; database: string | null };
type Catalog = {
  connection: string;
  database: string;
  columns: number;
  functions: string[];
  procedures: string[];
};
type Host = {
  editorCatalog: () => Catalog;
  catalogCalls: Call[];
  releaseColumns: () => void;
};

let browser: Browser;
beforeAll(async () => {
  if (url) browser = await chromium.launch({ channel: process.env.L8DB_BROWSER_CHANNEL });
}, 30_000);
afterAll(async () => {
  await browser?.close();
}, 15_000);

async function fixture({
  active = "manual",
  manualTables = 1,
  holdColumns = false,
  width = 1140,
  colorScheme = "dark",
}: {
  active?: string;
  manualTables?: number;
  holdColumns?: boolean;
  width?: number;
  colorScheme?: "light" | "dark";
} = {}) {
  const context = await browser.newContext({
    colorScheme,
    viewport: { width, height: 820 },
    reducedMotion: "reduce",
  });
  await context.addInitScript(
    ({ active, manualTables, holdColumns }) => {
      const host = window as unknown as Host;
      const calls: Call[] = [];
      const connections = ["legacy", "manual"].map((id) => ({
        id,
        name: id === "legacy" ? "Altverbindung" : "Manuelle Verbindung",
        kind: "postgres",
        connectionString: `postgresql://fixture@127.0.0.1:5432/${id}?sslmode=disable`,
        sslMode: "disable",
        ...(id === "manual" ? { editorMetadataPrefetch: false } : {}),
      }));
      if (!localStorage.getItem("l8db.connections"))
        localStorage.setItem(
          "l8db.connections",
          JSON.stringify({ state: { activeId: active, connections }, version: 0 }),
        );
      const delayed = holdColumns
        ? new Promise<void>((resolve) => {
            host.releaseColumns = resolve;
          })
        : null;
      const tables = (database: string | null) =>
        Array.from({ length: database === "manual" ? manualTables : 1 }, (_, index) => ({
          schema: "public",
          name: `${database}_${String(index).padStart(4, "0")}`,
        }));
      Object.assign(window, {
        catalogCalls: calls,
        __TAURI_INTERNALS__: {
          invoke: async (
            command: string,
            args?: { database?: string; connectionString?: string },
          ) => {
            const database =
              args?.database ?? args?.connectionString?.match(/\/([^/?]+)\?/)?.[1] ?? null;
            calls.push({ command, database });
            switch (command) {
              case "list_schemas":
                return ["public"];
              case "list_databases":
                return ["legacy", "manual", "second"];
              case "get_table_rls":
                return { enabled: false, forced: false, policies: [] };
              case "list_tables":
                return tables(database);
              case "list_all_columns":
                if (database === "manual" && delayed) await delayed;
                return tables(database).flatMap(({ schema, name: table }) =>
                  Array.from({ length: 8 }, (_, index) => ({
                    schema,
                    table,
                    name: `column_${index}`,
                    data_type: "text",
                  })),
                );
              case "list_views":
                return [{ schema: "public", name: `${database}_view` }];
              case "list_materialized_views":
                return [{ schema: "public", name: `${database}_matview` }];
              case "list_functions":
              case "list_procedures":
                return [{ schema: "public", name: `${database}_${command}`, arguments: "" }];
              case "execute_query":
                return {
                  columns: ["value"],
                  rows: [{ value: 1 }],
                  rows_affected: null,
                  execution_time_ms: 1,
                };
              case "cancel_execution":
                return true;
              case "load_secret":
              case "delete_secret":
                return null;
              default:
                return [];
            }
          },
        },
      });
    },
    { active, manualTables, holdColumns },
  );
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => {
    if (error.message !== "ResizeObserver loop completed with undelivered notifications.")
      errors.push(error.message);
  });
  page.setDefaultTimeout(7500);
  await page.goto(`${url}/tests/fixtures/editor-metadata.html`, { timeout: 45_000 });
  await page.getByRole("status", { name: "Pflichtmetadaten" }).getByText("Bereit").waitFor();
  await page.getByRole("complementary", { name: "Query-Navigator" }).waitFor();
  return { context, page, errors };
}

const snapshot = (page: Page) => page.evaluate(() => (window as unknown as Host).catalogCalls);
const optionalCalls = (calls: Call[]) => calls.filter(({ command }) => optional.includes(command));
const nav = (page: Page) => page.getByRole("complementary", { name: "Query-Navigator" });
const load = (page: Page) => nav(page).getByRole("button", { name: "Editor-Metadaten laden" });
const choose = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true }).click();

async function waitForCatalog(page: Page, database: string, columns: number) {
  await page.waitForFunction(
    ({ database, columns }) => {
      const catalog = (window as unknown as Host).editorCatalog();
      return (
        catalog.database === database &&
        catalog.columns === columns &&
        (columns === 0 ||
          (catalog.functions.includes(`${database}_list_functions`) &&
            catalog.procedures.includes(`${database}_list_procedures`)))
      );
    },
    { database, columns },
  );
}

run(
  "old connections preload and the saved opt-out prevents catalog refetch without disabling required metadata",
  async () => {
    const { context, page, errors } = await fixture({ active: "legacy", colorScheme: "light" });
    try {
      await waitForCatalog(page, "legacy", 8);
      await nav(page).getByText("legacy_matview", { exact: true }).waitFor();
      const beforeSave = await snapshot(page);
      expect(
        optionalCalls(beforeSave)
          .map(({ command }) => command)
          .sort(),
      ).toEqual(optional);
      expect(
        beforeSave
          .filter(({ command }) => mandatory.includes(command))
          .map(({ command }) => command)
          .sort(),
      ).toEqual(mandatory);

      await choose(page, "Verbindung bearbeiten");
      await page.getByRole("button", { name: /Erweitert/ }).click();
      const setting = page.getByRole("switch", { name: "Editor-Metadaten vorab laden" });
      expect(await setting.getAttribute("aria-checked")).toBe("true");
      await setting.press("Space");
      expect(await setting.getAttribute("aria-checked")).toBe("false");
      await page.setViewportSize({ width: 410, height: 820 });
      await setting.scrollIntoViewIfNeeded();
      expect(await setting.evaluate((element) => element === document.activeElement)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        410,
      );
      await mkdir("test-artifacts/browser", { recursive: true });
      await page.screenshot({ path: "test-artifacts/browser/editor-metadata-option.png" });
      await page.getByRole("button", { name: "Verbindung speichern", exact: true }).click();
      await page.getByRole("button", { name: "Verbindung bearbeiten", exact: true }).waitFor();
      await page.setViewportSize({ width: 1140, height: 820 });
      await nav(page).getByText("legacy_0000", { exact: true }).waitFor();
      const afterSave = await snapshot(page);
      expect(optionalCalls(afterSave)).toEqual(optionalCalls(beforeSave));
      const saved = await page.evaluate(
        () => JSON.parse(localStorage.getItem("l8db.connections") ?? "{}").state,
      );
      expect(
        saved.connections.find(({ id }: { id: string }) => id === "legacy").editorMetadataPrefetch,
      ).toBe(false);
      await page.reload();
      await load(page).waitFor();
      await page.getByRole("status", { name: "Pflichtmetadaten" }).getByText("Bereit").waitFor();
      await waitForCatalog(page, "legacy", 0);
      expect(optionalCalls(await snapshot(page))).toHaveLength(0);
      expect(
        (await snapshot(page)).filter(({ command }) => command === "execute_query"),
      ).toHaveLength(0);
      await choose(page, "Statement ausführen");
      await page.waitForFunction(() =>
        (window as unknown as Host).catalogCalls.some(({ command }) => command === "execute_query"),
      );
      expect(optionalCalls(await snapshot(page))).toHaveLength(0);
      expect(
        (await snapshot(page))
          .filter(({ command }) => mandatory.includes(command))
          .map(({ command }) => command)
          .sort(),
      ).toEqual(mandatory);
      await choose(page, "Verbindung bearbeiten");
      await page.getByRole("switch", { name: "Editor-Metadaten vorab laden" }).press("Space");
      await page.getByRole("button", { name: "Verbindung speichern", exact: true }).click();
      await waitForCatalog(page, "legacy", 8);
      const afterReenable = optionalCalls(await snapshot(page));
      expect(afterReenable.map(({ command }) => command).sort()).toEqual(optional);
      await choose(page, "Manuelle Verbindung");
      await waitForCatalog(page, "manual", 0);
      await load(page).waitFor();
      expect(optionalCalls(await snapshot(page))).toEqual(afterReenable);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  },
  65_000,
);

run(
  "manual metadata stays scoped during a pending request and reuses the matching cache",
  async () => {
    const { context, page, errors } = await fixture({ holdColumns: true });
    try {
      await waitForCatalog(page, "manual", 0);
      expect(optionalCalls(await snapshot(page))).toHaveLength(0);
      await load(page).press("Enter");
      await page.waitForFunction(() =>
        (window as unknown as Host).catalogCalls.some(
          ({ command }) => command === "list_all_columns",
        ),
      );
      await page.waitForFunction(() =>
        (window as unknown as Host).editorCatalog().functions.includes("manual_list_functions"),
      );
      expect(await load(page).isDisabled()).toBe(true);
      await choose(page, "Wechseldatenbank");
      await waitForCatalog(page, "second", 0);
      await load(page).click();
      await waitForCatalog(page, "second", 8);
      await nav(page).getByText("second_matview", { exact: true }).waitFor();
      await page.evaluate(() => (window as unknown as Host).releaseColumns());

      const visible = nav(page).getByText("second_0000", { exact: true });
      await visible.waitFor();
      expect(await nav(page).getByText("manual_0000").count()).toBe(0);
      const commands = optionalCalls(await snapshot(page));
      for (const database of ["manual", "second"])
        expect(
          commands
            .filter((call) => call.database === database)
            .map(({ command }) => command)
            .sort(),
        ).toEqual(optional);

      await choose(page, "Erste Datenbank");
      await waitForCatalog(page, "manual", 8);
      await nav(page).getByText("manual_0000", { exact: true }).waitFor();
      await choose(page, "Zweiter SQL-Tab");
      await page
        .getByRole("button", { name: "Statement ausführen", exact: true })
        .isDisabled()
        .then((disabled) => expect(disabled).toBe(true));
      await nav(page).getByText("manual_0000", { exact: true }).waitFor();
      await choose(page, "Erster SQL-Tab");
      await nav(page).getByText("manual_0000", { exact: true }).waitFor();
      expect(optionalCalls(await snapshot(page))).toEqual(commands);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  },
  65_000,
);

run(
  "manual catalog with 1200 tables and 9600 columns stays virtualized and never reloads on cached navigation or idle",
  async () => {
    const { context, page, errors } = await fixture({ manualTables: 1200 });
    try {
      expect(optionalCalls(await snapshot(page))).toHaveLength(0);
      await load(page).click();
      await waitForCatalog(page, "manual", 9600);
      await nav(page).getByText("1202 / 1202 Tabellen").waitFor();
      const nodes = await nav(page).locator("details").count();
      expect(nodes).toBeLessThan(100);
      expect(nodes).toBeGreaterThan(0);
      await choose(page, "Wechseldatenbank");
      await load(page).waitFor();
      await waitForCatalog(page, "second", 0);
      await page.getByRole("status", { name: "Pflichtmetadaten" }).getByText("Bereit").waitFor();
      const before = await snapshot(page);
      expect(
        optionalCalls(before)
          .map(({ command }) => command)
          .sort(),
      ).toEqual(optional);
      const target = page.getByRole("button", { name: "Erste Datenbank", exact: true });
      const samples: number[] = [];
      for (let index = 0; index < 10; index++) {
        const elapsed = await measureAppClick(
          page,
          target,
          '[aria-label="Query-Navigator"] details',
        );
        if (index > 1) samples.push(elapsed);
        await choose(page, "Wechseldatenbank");
        await load(page).waitFor();
      }
      const latency = interactionPercentiles(samples);
      if (!process.env.CI) expect(latency.p95Ms).toBeLessThanOrEqual(120);
      await page.waitForTimeout(300);
      expect(await snapshot(page)).toEqual(before);
      console.log("A30 Katalogleistung", {
        ...latency,
        nodes,
        catalogRequests: optionalCalls(before).length,
        extraRequests: 0,
      });
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  },
  65_000,
);
