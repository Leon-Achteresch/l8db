import { afterAll, beforeAll, expect, test } from "bun:test";
import { type Browser, chromium, type Page } from "playwright";
import { interactionPercentiles, measureAppClick } from "./fixtures/perf-app-interactions";

const url = process.env.L8DB_TABLE_BROWSER_URL;
const run = url ? test : test.skip;
const rule = "[data-column-on-update]";
type Scope = { kind: string; database?: string; schema: string; table: string };
type Call = { command: string; scope: Scope };
type Host = Window & {
  columnMetadataCalls: Call[];
  releaseColumnMetadata?: () => void;
  columnMetadataResolved?: boolean;
};
let browser: Browser;
beforeAll(async () => {
  if (url) browser = await chromium.launch({ channel: process.env.L8DB_BROWSER_CHANNEL });
});
afterAll(async () => {
  await browser?.close();
});

async function fixture(width: number, hold = false, wide = false) {
  const context = await browser.newContext({
    viewport: { width, height: 760 },
    colorScheme: width < 500 ? "dark" : "light",
    reducedMotion: "reduce",
  });
  try {
    await context.addInitScript(
      ({ hold, wide }) => {
        const host = window as Host;
        host.columnMetadataCalls = [];
        const common = {
          is_nullable: true,
          is_primary_key: false,
          column_default: null,
          character_maximum_length: null,
          ordinal_position: 1,
          data_type: "timestamp",
        };
        const defaultOnly = {
          ...common,
          name: "default_only",
          column_default: "CURRENT_TIMESTAMP",
        };
        const recorded = {
          ...common,
          name: "changed_at",
          column_default: "CURRENT_TIMESTAMP",
          on_update: "CURRENT_TIMESTAMP",
        };
        Object.assign(host, {
          __TAURI_INTERNALS__: {
            invoke: async (command: string, scope: Scope) => {
              host.columnMetadataCalls.push({ command, scope });
              if (command === "table_comment" || command === "get_table_comment") return null;
              if (command !== "list_table_columns_detailed")
                throw Error(`Unexpected IPC ${command}`);
              if (scope.kind !== "mysql") return [{ ...recorded, comment: "Other provider" }];
              if (scope.database === "second")
                return [{ ...defaultOnly, comment: "Other database" }];
              if (scope.table === "legacy") return [{ ...defaultOnly, comment: "Legacy payload" }];
              if (scope.schema === "second") {
                if (hold) {
                  await new Promise<void>((release) => {
                    host.releaseColumnMetadata = release;
                  });
                  host.columnMetadataResolved = true;
                }
                return [
                  { ...recorded, comment: "Second schema", on_update: "CURRENT_TIMESTAMP(2)" },
                ];
              }
              if (wide)
                return Array.from({ length: 250 }, (_, index) => ({
                  ...recorded,
                  ordinal_position: index + 1,
                  name: `event_time_${index}`,
                }));
              return [
                defaultOnly,
                { ...recorded, ordinal_position: 2, comment: "First schema" },
                {
                  ...recorded,
                  name: "precise",
                  data_type: "datetime(6)",
                  column_default: "CURRENT_TIMESTAMP(6)",
                  on_update: "CURRENT_TIMESTAMP(6)",
                  ordinal_position: 3,
                },
                { ...recorded, name: "update_only", column_default: null, ordinal_position: 4 },
                { ...common, name: "no_rule", ordinal_position: 5 },
                { ...recorded, name: "unknown", on_update: "NOW()", ordinal_position: 6 },
              ];
            },
          },
        });
      },
      { hold, wide },
    );
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${url}/tests/fixtures/mysql-column-update.html`);
    await page.locator(rule).first().waitFor();
    return { context, page, errors };
  } catch (error) {
    await context.close();
    throw error;
  }
}

const scopeButton = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
const calls = (page: Page) => page.evaluate(() => (window as Host).columnMetadataCalls);
const detailCalls = async (page: Page) =>
  (await calls(page)).filter((call) => call.command === "list_table_columns_detailed");
const row = (page: Page, name: string) =>
  page
    .getByText(name, { exact: true })
    .locator("xpath=ancestor::div[contains(@class, 'group grid')]");

run(
  "MySQL column details separate the default from the confirmed update rule",
  async () => {
    const { context, page, errors } = await fixture(425);
    try {
      expect(await page.locator(rule).count()).toBe(3);
      for (const name of ["default_only", "no_rule", "unknown"]) {
        expect(await row(page, name).locator(rule).count()).toBe(0);
      }
      const precise = row(page, "precise");
      expect(await precise.locator('[title="CURRENT_TIMESTAMP(6)"]').count()).toBe(1);
      expect(await precise.locator(rule).getAttribute("title")).toBe(
        "ON UPDATE CURRENT_TIMESTAMP(6)",
      );
      expect(await row(page, "update_only").locator('[title="Kein Standardwert"]').count()).toBe(1);
      expect(await detailCalls(page)).toHaveLength(1);
      const before = await calls(page);
      const edit = scopeButton(page, "precise bearbeiten");
      await edit.focus();
      await page.locator("button:focus").and(edit).press("Enter");
      const defaultInput = page.getByRole("textbox", { name: "Standardwert von precise" });
      expect(await defaultInput.inputValue()).toBe("CURRENT_TIMESTAMP(6)");
      await scopeButton(page, "Abbrechen").press("Enter");
      await precise.locator(rule).waitFor();
      expect(await calls(page)).toEqual(before);
      if (process.env.L8DB_COLUMN_UPDATE_SCREENSHOT) {
        await page.setViewportSize({ width: 1000, height: 640 });
        await page.screenshot({ path: process.env.L8DB_COLUMN_UPDATE_SCREENSHOT });
      }
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  },
  30_000,
);

run(
  "late metadata stays in its original schema, database and provider scope",
  async () => {
    const { context, page, errors } = await fixture(1024, true);
    try {
      await scopeButton(page, "Second schema").press("Enter");
      await page.waitForFunction(() => Boolean((window as Host).releaseColumnMetadata));
      expect(await page.locator(rule).count()).toBe(0);
      await scopeButton(page, "First schema").click();
      await page.getByText("First schema", { exact: true }).last().waitFor();
      await page.evaluate(() => (window as Host).releaseColumnMetadata?.());
      await page.waitForFunction(() => (window as Host).columnMetadataResolved === true);
      expect(await row(page, "changed_at").locator(rule).getAttribute("title")).toBe(
        "ON UPDATE CURRENT_TIMESTAMP",
      );
      await scopeButton(page, "Second schema").click();
      await row(page, "changed_at").locator('[title="ON UPDATE CURRENT_TIMESTAMP(2)"]').waitFor();
      expect(await detailCalls(page)).toHaveLength(2);
      await scopeButton(page, "Other database").click();
      await row(page, "default_only").getByText("Other database", { exact: true }).waitFor();
      expect(await page.locator(rule).count()).toBe(0);
      await scopeButton(page, "Other provider").click();
      await row(page, "changed_at").getByText("Other provider", { exact: true }).waitFor();
      expect(await page.locator(rule).count()).toBe(0);
      expect(await detailCalls(page)).toHaveLength(4);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  },
  30_000,
);

run(
  "wide column details remain bounded without extra provider or idle work",
  async () => {
    const { context, page, errors } = await fixture(1220, false, true);
    try {
      expect(await page.locator(rule).count()).toBe(250);
      const widths = await page
        .locator(rule)
        .evaluateAll((items) => items.map((item) => item.querySelectorAll("*").length));
      expect(Math.max(...widths)).toBeLessThanOrEqual(5);
      const before = await calls(page);
      const field = page.getByRole("textbox");
      const samples: number[] = [];
      for (let index = 0; index < 8; index++) {
        await field.fill("no_match");
        await page.locator(rule).first().waitFor({ state: "detached" });
        const ms = await measureAppClick(page, scopeButton(page, "Suche leeren"), rule);
        if (index > 1) samples.push(ms);
      }
      const latency = interactionPercentiles(samples);
      if (!process.env.CI) expect(latency.p95Ms).toBeLessThanOrEqual(250);
      const legacyCalls = await detailCalls(page);
      expect(legacyCalls).toHaveLength(1);
      expect(await calls(page)).toEqual(before);
      await page.waitForTimeout(300);
      expect(await calls(page)).toEqual(before);
      await scopeButton(page, "Legacy metadata").click();
      await row(page, "default_only").getByText("Legacy payload").waitFor();
      expect(await page.locator(rule).count()).toBe(0);
      expect(await detailCalls(page)).toHaveLength(2);
      expect(errors).toEqual([]);
      console.log("A44 browser", {
        columns: 250,
        ...latency,
        maxRuleDescendants: Math.max(...widths),
        additionalIpc: 0,
      });
    } finally {
      await context.close();
    }
  },
  35_000,
);
