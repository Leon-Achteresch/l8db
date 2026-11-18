import { afterAll, beforeAll, expect, test } from "bun:test";
import { type Browser, chromium, type Page } from "playwright";
import { interactionPercentiles, measureAppClick } from "./fixtures/perf-app-interactions";

const url = process.env.L8DB_TABLE_BROWSER_URL;
const run = url ? test : test.skip;
const badge = (page: Page) => page.getByRole("button", { name: "UNLOGGED", exact: true });
const details = (page: Page) => page.getByRole("dialog", { name: "Persistenz der Tabelle" });
const open = (page: Page, label: string) =>
  page.getByRole("link", { name: label, exact: true }).click();
type Args = {
  kind?: string;
  schema?: string;
  table?: string;
  database?: string;
  connectionString?: string;
  withTableContext?: boolean;
};
type Call = { command: string; args?: Args };
type Host = Window & {
  tablePersistenceCalls: Call[];
  holdTablePersistence: boolean;
  releaseTablePersistence?: () => void;
  resolvedTablePersistence?: boolean;
};
let browser: Browser;

beforeAll(async () => {
  if (url) browser = await chromium.launch({ channel: process.env.L8DB_BROWSER_CHANNEL });
}, 30_000);
afterAll(async () => {
  await browser?.close();
}, 15_000);

async function fixture(width: number, hold = false, wide = false) {
  const context = await browser.newContext({
    colorScheme: width < 500 ? "dark" : "light",
    viewport: { width, height: 780 },
    reducedMotion: "reduce",
  });
  try {
    await context.addInitScript(
      ({ hold, wide }) => {
        const host = window as Host;
        host.tablePersistenceCalls = [];
        host.holdTablePersistence = hold;
        const names = ["id", ...Array.from({ length: wide ? 249 : 1 }, (_, i) => `field_${i}`)];
        const columns = names.map((name, index) => ({
          name,
          data_type: index ? "text" : "integer",
          is_nullable: true,
          column_default: null,
          is_primary_key: false,
          ordinal_position: index + 1,
          character_maximum_length: null,
        }));
        Object.assign(host, {
          __TAURI_INTERNALS__: {
            invoke: async (command: string, args?: Args) => {
              host.tablePersistenceCalls.push({ command, args });
              if (command === "count_table_rows") return 100;
              if (command === "count_table_rows_capped")
                return { count: 100, exact: true, estimate: null };
              if (command === "fetch_table_rows") {
                return {
                  columns: names,
                  rows: Array.from({ length: 100 }, (_, index) => ({
                    id: index,
                    field_0: "synthetic",
                  })),
                };
              }
              if (command === "list_table_columns_detailed") {
                const ownConnection = args?.connectionString === "postgresql://localhost/first";
                if (!ownConnection || args?.schema !== "scratch" || args?.database !== "first") {
                  if (args?.kind === "mysql") return { columns, unlogged: true };
                  if (args?.schema === "unknown" || args?.database === "second") return columns;
                  return { columns };
                }
                if (host.holdTablePersistence) {
                  host.holdTablePersistence = false;
                  await new Promise<void>((release) => {
                    host.releaseTablePersistence = release;
                  });
                  host.resolvedTablePersistence = true;
                }
                return { columns, unlogged: true };
              }
              return [];
            },
          },
        });
      },
      { hold, wide },
    );
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${url}/tests/fixtures/table-state.html?persistence=1`);
    await page.locator("tbody tr[data-index]").first().waitFor();
    return { context, page, errors };
  } catch (error) {
    await context.close();
    throw error;
  }
}

const calls = (page: Page) => page.evaluate(() => (window as Host).tablePersistenceCalls);

run(
  "only confirmed PostgreSQL table metadata labels the current schema, database and connection",
  async () => {
    const { context, page, errors } = await fixture(390, true);
    try {
      expect(await badge(page).count()).toBe(0);
      await open(page, "Cached customers");
      await page.waitForFunction(() => Boolean((window as Host).releaseTablePersistence));
      expect(await badge(page).count()).toBe(0);
      await open(page, "Customers");
      await page.evaluate(() => (window as Host).releaseTablePersistence?.());
      await page.waitForFunction(() => (window as Host).resolvedTablePersistence);
      expect(await badge(page).count()).toBe(0);

      await open(page, "Cached customers");
      await badge(page).waitFor();
      const checked = (await calls(page)).filter(
        (call) => call.command === "list_table_columns_detailed",
      );
      expect(checked.filter((call) => call.args?.schema === "scratch")).toHaveLength(1);
      expect(checked.filter((call) => call.args?.schema === "public")).toHaveLength(1);
      expect(checked.every((call) => call.args?.withTableContext === true)).toBe(true);
      const before = await calls(page);
      await badge(page).press("Enter");
      await details(page)
        .getByText(/Write-Ahead Log/)
        .waitFor();
      const popup = await details(page).boundingBox();
      expect(popup?.x).toBeGreaterThanOrEqual(0);
      expect((popup?.x ?? 0) + (popup?.width ?? 0)).toBeLessThanOrEqual(390);
      if (process.env.L8DB_TABLE_PERSISTENCE_SCREENSHOT) {
        await page.screenshot({ path: process.env.L8DB_TABLE_PERSISTENCE_SCREENSHOT });
      }
      await page.keyboard.press("Escape");
      await details(page).waitFor({ state: "detached" });
      await badge(page).and(page.locator(":focus")).waitFor();
      expect(await calls(page)).toEqual(before);

      await page.getByRole("button", { name: "Database B", exact: true }).click();
      await badge(page).waitFor({ state: "detached" });
      await page.getByRole("button", { name: "Database A", exact: true }).click();
      await badge(page).waitFor();
      await page.getByRole("button", { name: "Other connection" }).click();
      await badge(page).waitFor({ state: "detached" });
      await page.getByRole("button", { name: "Other provider" }).click();
      await page.waitForFunction(() =>
        (window as Host).tablePersistenceCalls.some(
          (call) => call.command === "list_table_columns_detailed" && call.args?.kind === "mysql",
        ),
      );
      expect(await badge(page).count()).toBe(0);
      expect(
        (await calls(page)).find(
          (call) => call.command === "list_table_columns_detailed" && call.args?.kind === "mysql",
        )?.args?.withTableContext,
      ).toBeUndefined();
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  },
  35_000,
);

run(
  "wide-table indicator adds no metadata requests or repeated DOM work",
  async () => {
    const { context, page, errors } = await fixture(1220, false, true);
    try {
      for (const name of ["Temporary customers", "Unknown customers"]) {
        await open(page, name);
        const schema = name.startsWith("Temp") ? "pg_temp_3" : "unknown";
        await page.waitForFunction(
          (schema) =>
            (window as Host).tablePersistenceCalls.some(
              (call) =>
                call.command === "list_table_columns_detailed" && call.args?.schema === schema,
            ),
          schema,
        );
        expect(await badge(page).count()).toBe(0);
      }
      await open(page, "Cached customers");
      await badge(page).waitFor();
      expect(await badge(page).count()).toBe(1);
      const before = await calls(page);
      const samples: number[] = [];
      let nodes = 0;
      for (let index = 0; index < 8; index++) {
        const latency = await measureAppClick(
          page,
          badge(page),
          '[aria-label="Persistenz der Tabelle"] p',
        );
        if (index > 1) samples.push(latency);
        nodes = Math.max(nodes, await details(page).locator("*").count());
        await page.keyboard.press("Escape");
        await details(page).waitFor({ state: "detached" });
      }
      const latency = interactionPercentiles(samples);
      expect(latency.p95Ms).toBeLessThanOrEqual(250);
      expect(nodes).toBeLessThan(10);
      await page.waitForTimeout(300);
      expect(await calls(page)).toEqual(before);
      expect(errors).toEqual([]);
      console.log("A47 Persistenzhinweis", {
        ...latency,
        columns: 250,
        rows: 100,
        maxPopoverDescendants: nodes,
        additionalIpc: 0,
      });
    } finally {
      await context.close();
    }
  },
  35_000,
);
