import { afterAll, beforeAll, expect, test } from "bun:test";
import { type Browser, chromium, type Page } from "playwright";
import { interactionPercentiles, measureAppClick } from "./fixtures/perf-app-interactions";

const url = process.env.L8DB_TABLE_BROWSER_URL;
const run = url ? test : test.skip;
const hint = "[data-oracle-text-limit]";
const detail = "list_table_columns_detailed";
type Scope = { kind: string; database?: string; schema: string; table: string };
type Call = { command: string; scope: Scope };
type Host = Window & {
  oracleTextCalls: Call[];
  releaseOracleDetail?: () => void;
  oracleDetailResolved?: boolean;
};
let browser: Browser;
beforeAll(async () => {
  if (url) browser = await chromium.launch({ channel: process.env.L8DB_BROWSER_CHANNEL });
}, 30_000);
afterAll(async () => {
  await browser?.close();
}, 15_000);

async function fixture(width: number, wide = false) {
  if (!url) throw Error("Missing isolated browser fixture");
  const context = await browser.newContext({
    viewport: { width, height: 720 },
    colorScheme: width < 500 ? "dark" : "light",
    reducedMotion: "reduce",
  });
  try {
    const origin = new URL(url).origin;
    await context.route("**/*", (route) =>
      new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
    );
    await context.addInitScript((wide) => {
      const host = window as Host;
      host.oracleTextCalls = [];
      const common = {
        is_nullable: true,
        is_primary_key: false,
        column_default: null,
        character_maximum_length: 4,
        ordinal_position: 1,
        data_type: "VARCHAR2(4)",
        name: "TEXT_VALUE",
      };
      const bytes = {
        ...common,
        oracle_text_limit: { length: 4, unit: "BYTE" },
        comment: "é界",
      };
      const chars = {
        ...common,
        data_type: "VARCHAR2(2)",
        character_maximum_length: 2,
        oracle_text_limit: { length: 2, unit: "CHAR" },
      };
      Object.assign(host, {
        __TAURI_INTERNALS__: {
          invoke: async (command: string, scope: Scope) => {
            host.oracleTextCalls.push({ command, scope });
            if (command === "get_table_comment" || command === "table_comment") return null;
            if (command !== "list_table_columns_detailed") throw Error(`Unexpected IPC ${command}`);
            if (scope.kind !== "oracle") return [{ ...bytes, comment: "Other provider" }];
            if (scope.table === "legacy") return [{ ...common, comment: "Legacy payload" }];
            if (scope.schema === "second") {
              await new Promise<void>((release) => {
                host.releaseOracleDetail = release;
              });
              host.oracleDetailResolved = true;
              return [chars];
            }
            if (wide) {
              return Array.from({ length: 250 }, (_, index) => ({
                ...(index % 2 ? bytes : chars),
                name: `TEXT_${index}`,
                ordinal_position: index + 1,
              }));
            }
            return [
              bytes,
              { ...chars, name: "MULTIBYTE_TEXT" },
              { ...chars, data_type: "NVARCHAR2(2)", name: "NATIONAL_TEXT" },
              { ...common, name: "NO_EVIDENCE" },
              { ...bytes, name: "BAD_UNIT", oracle_text_limit: { length: 4, unit: "X" } },
              { ...bytes, name: "BAD_LIMIT", oracle_text_limit: { length: 0, unit: "BYTE" } },
              { ...bytes, name: "RAW_VALUE", data_type: "RAW(4)" },
            ];
          },
        },
      });
    }, wide);
    const page = await context.newPage();
    page.setDefaultTimeout(7500);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${url}/tests/fixtures/mysql-column-update.html?oracle`);
    await page.locator(hint).first().waitFor();
    return { context, page, errors };
  } catch (error) {
    await context.close();
    throw error;
  }
}

const button = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
const row = (page: Page, name: string) =>
  page
    .getByText(name, { exact: true })
    .locator("xpath=ancestor::div[contains(@class, 'group grid')]");
const calls = (page: Page) => page.evaluate(() => (window as Host).oracleTextCalls);
const detailCalls = async (page: Page) =>
  (await calls(page)).filter((call) => call.command === detail);

run(
  "declared BYTE and CHAR appear beside the existing Oracle column type",
  async () => {
    const { context, page, errors } = await fixture(980);
    try {
      await row(page, "TEXT_VALUE").getByText("VARCHAR2(4)", { exact: true }).waitFor();
      await row(page, "TEXT_VALUE").getByText("é界", { exact: true }).waitFor();
      expect(await row(page, "TEXT_VALUE").locator(hint).getAttribute("title")).toBe(
        "Deklarierte Textgrenze: 4 Byte",
      );
      for (const name of ["MULTIBYTE_TEXT", "NATIONAL_TEXT"]) {
        await row(page, name).locator(hint).getByText("2 CHAR", { exact: true }).waitFor();
      }
      for (const name of ["NO_EVIDENCE", "BAD_LIMIT", "BAD_UNIT", "RAW_VALUE"]) {
        expect(await row(page, name).locator(hint).count()).toBe(0);
      }
      const before = await calls(page);
      const screenshot = process.env.L8DB_ORACLE_TEXT_LIMIT_SCREENSHOT;
      if (screenshot) await row(page, "TEXT_VALUE").screenshot({ path: screenshot });
      const filter = page.getByPlaceholder("Spalten filtern…");
      await filter.press("Tab");
      await filter.fill("MULTIBYTE_TEXT");
      expect(await page.locator(hint).count()).toBe(1);
      expect(await calls(page)).toEqual(before);
      expect(await detailCalls(page)).toHaveLength(1);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  },
  30_000,
);

run(
  "late Oracle metadata and foreign provider payloads stay scoped",
  async () => {
    const { context, page, errors } = await fixture(1000);
    try {
      await button(page, "Second schema").press("Enter");
      await page.waitForFunction(() => Boolean((window as Host).releaseOracleDetail));
      expect(await page.locator(hint).count()).toBe(0);
      await button(page, "First schema").press("Enter");
      await row(page, "TEXT_VALUE").locator(hint).getByText("4 BYTE", { exact: true }).waitFor();
      await page.evaluate(() => (window as Host).releaseOracleDetail?.());
      await page.waitForFunction(() => (window as Host).oracleDetailResolved);
      expect(await row(page, "TEXT_VALUE").locator(hint).getAttribute("title")).toBe(
        "Deklarierte Textgrenze: 4 Byte",
      );
      await button(page, "Second schema").press("Enter");
      await row(page, "TEXT_VALUE").locator(hint).getByText("2 CHAR", { exact: true }).waitFor();
      await button(page, "Legacy metadata").press("Enter");
      await row(page, "TEXT_VALUE").getByText("Legacy payload").waitFor();
      expect(await page.locator(hint).count()).toBe(0);
      await button(page, "Other provider").press("Enter");
      await row(page, "TEXT_VALUE").getByText("Other provider").waitFor();
      expect(await page.locator(hint).count()).toBe(0);
      expect(await detailCalls(page)).toHaveLength(4);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  },
  30_000,
);

run(
  "a wide table adds one label per column and does no background work",
  async () => {
    const { context, page, errors } = await fixture(1170, true);
    try {
      expect(await page.locator(hint).count()).toBe(250);
      const filter = page.getByPlaceholder("Spalten filtern…");
      const clear = button(page, "Suche leeren");
      const before = await calls(page);
      const samples: number[] = [];
      for (let index = 0; index < 8; index++) {
        await filter.fill("TEXT_249");
        await row(page, "TEXT_0").waitFor({ state: "detached" });
        const elapsed = await measureAppClick(
          page,
          clear,
          '[title="Deklarierte Textgrenze: 2 Zeichen"]',
        );
        if (index > 1) samples.push(elapsed);
        expect(await page.locator(hint).count()).toBe(250);
      }
      const timing = interactionPercentiles(samples);
      if (!process.env.CI) expect(timing.p95Ms).toBeLessThanOrEqual(250);
      await page.waitForTimeout(300);
      expect(await calls(page)).toEqual(before);
      expect(errors).toEqual([]);
      console.log("A36 browser", { columns: 250, additionalLabels: 250, idleIpc: 0, ...timing });
    } finally {
      await context.close();
    }
  },
  45_000,
);
