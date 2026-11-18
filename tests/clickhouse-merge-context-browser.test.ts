import { afterAll, beforeAll, expect, test } from "bun:test";
import { type Browser, chromium, type Page } from "playwright";
import { interactionPercentiles, measureAppClick } from "./fixtures/perf-app-interactions";

const url = process.env.L8DB_TABLE_BROWSER_URL;
const run = url ? test : test.skip;
const replacing = "ReplacingMergeTree";
const collapsing = "CollapsingMergeTree";
const aggregated = "ReplicatedAggregatingMergeTree";
const badge = (page: Page, name = /Merge-Engine /) => page.getByRole("button", { name });
const details = (page: Page) => page.getByRole("dialog", { name: "ClickHouse-Merge-Engine" });
const open = (page: Page, name: string) => page.getByRole("link", { name, exact: true }).click();
const pick = (page: Page, name: string) => page.getByRole("button", { name, exact: true }).click();
type Args = {
  kind?: string;
  database?: string;
  schema?: string;
  table?: string;
  connectionString?: string;
  withTableContext?: boolean;
};
type Call = { command: string; args?: Args };
type Host = Window & {
  mergeCalls: Call[];
  releaseMergeResponse: Partial<Record<string, () => void>>;
  resolvedMergeResponse: Partial<Record<string, boolean>>;
};
let browser: Browser;

beforeAll(async () => {
  if (url) browser = await chromium.launch({ channel: process.env.L8DB_BROWSER_CHANNEL });
}, 30_000);

afterAll(async () => {
  await browser?.close();
}, 15_000);

async function fixture(width: number, hold: boolean, wide = false) {
  if (!url) throw Error("Missing isolated browser fixture");
  const context = await browser.newContext({
    colorScheme: width < 500 ? "dark" : "light",
    viewport: { width, height: 780 },
    reducedMotion: "reduce",
  });
  try {
    const origin = new URL(url).origin;
    await context.route("**/*", (route) =>
      new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
    );
    await context.addInitScript(
      ({ hold, wide }) => {
        const host = window as Host;
        host.mergeCalls = [];
        host.releaseMergeResponse = {};
        host.resolvedMergeResponse = {};
        const names = ["id", ...Array.from({ length: wide ? 249 : 1 }, (_, i) => `field_${i}`)];
        const columns = names.map((name, index) => ({
          name,
          data_type: index ? "String" : "UInt64",
          is_nullable: true,
          column_default: null,
          is_primary_key: index === 0,
          ordinal_position: index + 1,
          character_maximum_length: null,
        }));
        Object.assign(host, {
          __TAURI_INTERNALS__: {
            invoke: async (command: string, args?: Args) => {
              host.mergeCalls.push({ command, args });
              if (command === "count_table_rows") return 100;
              if (command === "count_table_rows_capped")
                return { count: 100, exact: true, estimate: null };
              if (command === "fetch_table_rows")
                return {
                  columns: names,
                  rows: Array.from({ length: 100 }, (_, index) => ({
                    id: index,
                    field_0: "sample",
                  })),
                };
              if (command !== "list_table_columns_detailed") return [];
              if (args?.table === "orders") return { columns, clickhouse_engine: "MergeTree" };
              if (args?.table === "old_metadata") return columns;
              if (args?.schema === "unknown")
                return { columns, clickhouse_engine: "FutureMergeTree" };
              if (args?.schema === "scratch") return { columns };
              if (args?.schema !== args?.database) return { columns };
              if (args?.kind !== "clickhouse")
                return { columns, clickhouse_engine: "ReplacingMergeTree" };
              const group = args?.connectionString?.includes(":30212")
                ? "connection"
                : args?.database === "second"
                  ? "database"
                  : "primary";
              if (hold && group !== "primary") {
                await new Promise<void>((resolve) => {
                  host.releaseMergeResponse[group] = resolve;
                });
                host.resolvedMergeResponse[group] = true;
              }
              const engine =
                group === "connection"
                  ? "ReplicatedAggregatingMergeTree"
                  : group === "database"
                    ? "CollapsingMergeTree"
                    : "ReplacingMergeTree";
              return { columns, clickhouse_engine: engine };
            },
          },
        });
      },
      { hold, wide },
    );
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => {
      if (error.message !== "ResizeObserver loop completed with undelivered notifications.")
        errors.push(error.message);
    });
    await page.goto(`${url}/tests/fixtures/table-state.html?merge-engine`);
    await badge(page).waitFor();
    return { context, page, errors };
  } catch (error) {
    await context.close();
    throw error;
  }
}

const calls = (page: Page) => page.evaluate(() => (window as Host).mergeCalls);

async function releaseAfterScopeChange(page: Page, scope: "database" | "connection") {
  await page.waitForFunction(
    (scope) => Boolean((window as Host).releaseMergeResponse[scope]),
    scope,
  );
  expect(await badge(page).count()).toBe(0);
  if (scope === "database") {
    await pick(page, "Database A");
    await open(page, "Customers");
  } else {
    await pick(page, "Other provider");
  }
  await page.evaluate((scope) => (window as Host).releaseMergeResponse[scope]?.(), scope);
  await page.waitForFunction((scope) => (window as Host).resolvedMergeResponse[scope], scope);
}

run(
  "confirmed engine has a keyboard-accessible scoped explanation without reads",
  async () => {
    const { context, page, errors } = await fixture(390, true);
    try {
      for (const name of ["Orders", "Old metadata", "Unknown customers", "Cached customers"]) {
        await open(page, name);
        await page.locator("tbody tr[data-index]").first().waitFor();
        expect(await badge(page).count()).toBe(0);
      }
      await open(page, "Customers");
      await badge(page, new RegExp(replacing)).waitFor();
      const trigger = badge(page, new RegExp(replacing));
      const before = await calls(page);
      expect(before.filter(({ command }) => command === "fetch_table_rows").length).toBeGreaterThan(
        0,
      );
      expect(before.some(({ command }) => command.startsWith("count_table_rows"))).toBe(true);
      await trigger.press("Enter");
      await details(page)
        .getByText(/normale Vorschau und Zeilenzählung/)
        .waitFor();
      const popup = await details(page).boundingBox();
      expect(popup?.x).toBeGreaterThanOrEqual(0);
      expect((popup?.x ?? 0) + (popup?.width ?? 0)).toBeLessThanOrEqual(390);
      if (process.env.L8DB_CLICKHOUSE_MERGE_SCREENSHOT) {
        await details(page).screenshot({ path: process.env.L8DB_CLICKHOUSE_MERGE_SCREENSHOT });
      }
      await page.keyboard.press("Escape");
      await details(page).waitFor({ state: "hidden" });
      await trigger.and(page.locator(":focus")).waitFor();
      expect(await calls(page)).toEqual(before);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  },
  35_000,
);

run(
  "late same-name metadata stays bound to the database and connection that requested it",
  async () => {
    const { context, page, errors } = await fixture(1040, true);
    try {
      await pick(page, "Database B");
      await open(page, "Customers");
      await releaseAfterScopeChange(page, "database");
      await badge(page, new RegExp(replacing)).waitFor();
      await pick(page, "Database B");
      await open(page, "Customers");
      await badge(page, new RegExp(collapsing)).waitFor();
      await pick(page, "Database A");
      await open(page, "Customers");
      await pick(page, "Other connection");
      await releaseAfterScopeChange(page, "connection");
      await page.waitForFunction(() =>
        (window as Host).mergeCalls.some(
          ({ command, args }) =>
            command === "list_table_columns_detailed" && args?.kind === "mysql",
        ),
      );
      expect(await badge(page).count()).toBe(0);
      await pick(page, "Other connection");
      await badge(page, new RegExp(aggregated)).waitFor();

      const checked = (await calls(page)).filter(
        ({ command, args }) =>
          command === "list_table_columns_detailed" &&
          args?.schema === args?.database &&
          args?.table === "customers" &&
          args?.kind === "clickhouse",
      );
      expect(checked).toHaveLength(3);
      expect(checked.every(({ args }) => args?.withTableContext === true)).toBe(true);
      expect(checked.filter(({ args }) => args?.database === "second")).toHaveLength(1);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  },
  35_000,
);

run(
  "wide table context adds no idle IPC or growing help content",
  async () => {
    const { context, page, errors } = await fixture(1220, false, true);
    try {
      await page.locator("tbody tr[data-index]").first().waitFor();
      const before = await calls(page);
      const samples: number[] = [];
      let descendants = 0;
      for (let index = 0; index < 8; index++) {
        const ms = await measureAppClick(
          page,
          badge(page),
          '[aria-label="ClickHouse-Merge-Engine"] p',
        );
        if (index > 1) samples.push(ms);
        descendants = Math.max(descendants, await details(page).locator("*").count());
        await page.keyboard.press("Escape");
        await details(page).waitFor({ state: "hidden" });
      }
      const latency = interactionPercentiles(samples);
      expect(latency.p95Ms).toBeLessThanOrEqual(250);
      expect(descendants).toBeLessThanOrEqual(3);
      await page.waitForTimeout(300);
      expect(await calls(page)).toEqual(before);
      expect(errors).toEqual([]);
      console.log("A46 browser", {
        columns: 250,
        rows: 100,
        ...latency,
        descendants,
        additionalIpc: 0,
      });
    } finally {
      await context.close();
    }
  },
  35_000,
);
