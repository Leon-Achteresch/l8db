import { afterAll, beforeAll, expect, test } from "bun:test";
import { type Browser, chromium, type Locator, type Page } from "playwright";

const url = process.env.L8DB_TABLE_BROWSER_URL;
const run = url ? test : test.skip;
const integer = "9007199254740993";
const groupedInteger = "9\u202f007\u202f199\u202f254\u202f740\u202f993";
const fraction = "-1234.5678901234567890123456";
const groupedFraction = "-1\u202f234.5678901234567890123456";

let browser: Browser;
beforeAll(async () => {
  if (url) browser = await chromium.launch({ channel: process.env.L8DB_BROWSER_CHANNEL });
}, 30_000);
afterAll(async () => {
  await browser?.close();
}, 15_000);

type Boundary = { commands: string[]; clipboard: string[] };
const path = () => `${url}/tests/fixtures/number-display.html`;
async function fixture(colorScheme: "light" | "dark", width = 1500) {
  const context = await browser.newContext({ colorScheme, viewport: { width, height: 740 } });
  await context.addInitScript(() => {
    const boundary: Boundary = { commands: [], clipboard: [] };
    Object.assign(window, {
      __numberBoundary: boundary,
      __TAURI_INTERNALS__: {
        invoke: async (command: string, args: Record<string, unknown> = {}) => {
          boundary.commands.push(command);
          if (command === "plugin:clipboard-manager|write_text") {
            boundary.clipboard.push(String(args.text));
            return;
          }
          throw Error(`Unexpected fixture IPC: ${command}`);
        },
      },
    });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  await page.goto(path(), { timeout: 20_000 });
  await page.locator(`html.${colorScheme}`).waitFor();
  return { context, page };
}

const table = (page: Page) => page.getByRole("region", { name: "Tabelle" });
const query = (page: Page) => page.getByRole("region", { name: "Query-Ergebnis" });
const actions = (scope: Locator) => scope.getByRole("button", { name: "Weitere Aktionen" });
const numbers = (page: Page) => page.getByRole("menuitem", { name: /^Zahlen:/ });
const radio = (page: Page, name: string) => page.getByRole("menuitemradio", { name, exact: true });
const focus = (locator: Locator) => locator.and(locator.page().locator(":focus")).waitFor();
const cell = (scope: Locator, col: string, row = 0) =>
  scope.locator(`tbody [data-col="${col}"]`).nth(row);
const events = (page: Page) =>
  page.evaluate(() => (window as unknown as { __numberBoundary: Boundary }).__numberBoundary);

async function text(locator: Locator, expected: string) {
  await locator.evaluate((element, value) => {
    if (element.textContent !== value)
      throw Error(`Expected ${JSON.stringify(value)}, got ${JSON.stringify(element.textContent)}`);
  }, expected);
}

async function openNumbers(page: Page, scope: Locator) {
  const trigger = actions(scope);
  await trigger.focus();
  await page.keyboard.press("Enter");
  await numbers(page).focus();
  await page.keyboard.press("ArrowRight");
  await radio(page, "Original").waitFor();
  return trigger;
}

async function choose(page: Page, scope: Locator, label: string) {
  const trigger = await openNumbers(page, scope);
  await radio(page, label).focus();
  await page.keyboard.press("Enter");
  await radio(page, label).waitFor({ state: "hidden" });
  await focus(trigger);
}

run(
  "original, grouping and 0/2/4 persist across real table and query views without rounding or DB IPC",
  async () => {
    const { page, context } = await fixture("light");
    try {
      await cell(table(page), "big").waitFor();
      await text(cell(table(page), "big"), integer);
      await text(cell(query(page), "actual"), "12345.5");
      await text(cell(table(page), "amount", 1), fraction);
      const opener = await openNumbers(page, table(page));
      expect(await radio(page, "Original").getAttribute("aria-checked")).toBe("true");
      expect(await radio(page, "4").getAttribute("data-disabled")).not.toBeNull();
      await focus(radio(page, "Original"));
      await page.keyboard.press("ArrowDown");
      await focus(radio(page, "Zifferngruppen"));
      await page.keyboard.press("Enter");
      await radio(page, "Original").waitFor({ state: "hidden" });
      await focus(opener);
      await text(cell(table(page), "big"), groupedInteger);
      await text(cell(table(page), "amount", 1), groupedFraction);
      await text(cell(query(page), "actual"), "12\u202f345.5");

      await choose(page, query(page), "2");
      await text(cell(table(page), "amount"), "1\u202f234.50");
      await text(cell(query(page), "actual"), "12\u202f345.50");
      await choose(page, table(page), "4");
      await text(cell(table(page), "big"), `${groupedInteger}.0000`);
      await text(cell(table(page), "amount"), "1\u202f234.5000");
      await text(cell(table(page), "amount", 1), groupedFraction);
      await text(cell(table(page), "reference"), "0012345");
      await text(cell(table(page), "big", 1), "NULL");
      await text(cell(query(page), "unknown"), integer);
      await text(cell(query(page), "blank"), "NULL");
      expect(await cell(table(page), "big").locator("span[title]").getAttribute("title")).toBe(
        integer,
      );
      expect(await cell(query(page), "actual").getAttribute("title")).toBe("12345.5");
      expect(await events(page)).toEqual({ clipboard: [], commands: [] });

      await page.reload({ timeout: 20_000 });
      await text(cell(query(page), "actual"), "12\u202f345.5000");
      await openNumbers(page, query(page));
      expect(await radio(page, "4").getAttribute("aria-checked")).toBe("true");
      await page.keyboard.press("Escape");
      await radio(page, "4").waitFor({ state: "hidden" });
      await focus(actions(query(page)));
      await choose(page, query(page), "Wie im Wert");
      await text(cell(table(page), "big"), groupedInteger);
      await choose(page, table(page), "Original");
      await text(cell(table(page), "big"), integer);
      await text(cell(query(page), "actual"), "12345.5");
      expect(await events(page)).toEqual({ clipboard: [], commands: [] });
    } finally {
      await context.close();
    }
  },
  60_000,
);

run(
  "grouped cells still copy and edit their original exact text in a dark compact view",
  async () => {
    const { page, context } = await fixture("dark", 365);
    try {
      const opener = await openNumbers(page, table(page));
      await page.waitForFunction(() => {
        const item = [...document.querySelectorAll('[role="menuitemradio"]')].find(
          (element) => element.textContent?.trim() === "Zifferngruppen",
        );
        const menu = item?.closest('[role="menu"]');
        if (!menu) return false;
        const rect = menu.getBoundingClientRect();
        return (
          rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight
        );
      });
      await page.keyboard.press("ArrowLeft");
      await radio(page, "Original").waitFor({ state: "hidden" });
      await focus(numbers(page));
      await page.keyboard.press("Escape");
      await focus(opener);
      await choose(page, table(page), "Zifferngruppen");
      const big = cell(table(page), "big");
      await big.click();
      await big.getByTitle("Kopieren", { exact: true }).click();
      expect((await events(page)).clipboard).toEqual([integer]);
      await big.dblclick();
      const editor = table(page).locator("tbody input");
      expect(await editor.inputValue()).toBe(integer);
      const updated = "900719925474099312345";
      await editor.fill(updated);
      await editor.press("Enter");
      const saved = page.getByLabel("Test-Speicherauftrag");
      await saved.getByText(/900719925474099312345/).waitFor();
      expect(JSON.parse((await saved.textContent()) ?? "{}")).toMatchObject({
        ctid: "(0,1)",
        updates: { big: updated },
        oldValues: { big: integer },
      });
      expect((await events(page)).commands).toEqual(["plugin:clipboard-manager|write_text"]);
    } finally {
      await context.close();
    }
  },
  45_000,
);
