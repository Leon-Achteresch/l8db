import { afterAll, beforeAll, expect, test } from "bun:test";
import { type Browser, chromium, type Locator, type Page } from "playwright";

const url = process.env.L8DB_TABLE_BROWSER_URL;
const run = url ? test : test.skip;
let browser: Browser;
beforeAll(async () => {
  if (url) browser = await chromium.launch({ channel: process.env.L8DB_BROWSER_CHANNEL });
}, 30_000);
afterAll(async () => {
  await browser?.close();
}, 15_000);

async function fixture() {
  const page = await browser.newPage({ viewport: { width: 1100, height: 820 } });
  page.setDefaultTimeout(5000);
  await page.addInitScript(() => {
    const commands: string[] = [];
    Object.assign(window, {
      __filterCommands: commands,
      __TAURI_INTERNALS__: {
        invoke: async (command: string) => {
          commands.push(command);
          return [];
        },
      },
    });
  });
  await page.goto(`${url}/tests/fixtures/filter-list.html`, { timeout: 20_000 });
  return page;
}

const sql = (scope: Page | Locator) => scope.getByRole("button", { name: "SQL-Liste übernehmen" });
const source = (page: Page) => page.getByRole("textbox", { name: "SQL-Liste übernehmen" });
const importPanel = (page: Page) =>
  page
    .locator('[data-slot="popover-content"]')
    .filter({ has: source(page) })
    .last();
const confirm = (page: Page) => importPanel(page).getByRole("button", { name: "Werte übernehmen" });
const valueInput = (scope: Page | Locator) => scope.getByRole("textbox", { name: "Listenwert" });
const apply = (scope: Page | Locator) => scope.getByRole("button", { name: "Filter anwenden" });
const counter = (page: Page) => page.getByLabel("Apply count");
const removed = (page: Page, value: string) =>
  page.getByRole("button", { name: `Wert entfernen: ${value}`, exact: true });

async function noQuery(page: Page, expectedApplies = "0") {
  expect(await counter(page).textContent()).toBe(expectedApplies);
  const commands = await page.evaluate(
    () => (window as unknown as { __filterCommands: string[] }).__filterCommands,
  );
  expect(commands.filter((name) => /query|fetch_table_rows|count_table_rows/.test(name))).toEqual(
    [],
  );
}

async function select(scope: Page | Locator, page: Page, name: string) {
  await scope.getByRole("combobox", { name: "Filteroperator" }).click();
  await page.getByRole("option", { name, exact: true }).click();
}

async function header(page: Page, column: string) {
  await page.locator(`th[data-column-id="${column}"]`).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Filter setzen…" }).click();
  const popover = page.locator('[data-slot="popover-content"]').filter({ has: apply(page) });
  await popover.waitFor();
  return popover;
}

async function paste(input: Locator, text: string) {
  await input.focus();
  await input.evaluate((element, value) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", value);
    element.dispatchEvent(
      new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }),
    );
  }, text);
}

async function focused(locator: Locator) {
  await locator.and(locator.page().locator(":focus")).waitFor();
}

run(
  "SQL button in the column IN popover previews bounded entries and confirms independently",
  async () => {
    const page = await fixture();
    try {
      const column = await header(page, "name");
      await select(column, page, "ist in Liste");
      const button = sql(column);
      await button.focus();
      await button.press("Enter");
      await source(page).waitFor();
      await focused(source(page));
      await source(page).fill("('unvollständig',");
      expect(await confirm(page).isDisabled()).toBe(true);
      expect(await importPanel(page).getByRole("alert").count()).toBe(1);
      await source(page).press("Enter");
      expect(await source(page).inputValue()).toBe("('unvollständig',\n");
      await noQuery(page);
      await source(page).press("Escape");
      await source(page).waitFor({ state: "hidden" });
      await focused(button);
      expect(await apply(column).isDisabled()).toBe(true);
      expect(await removed(page, "unvollständig").count()).toBe(0);

      await button.press("Space");
      await source(page).fill(
        `('O''Brien', 'a,b', '東京', 'D', '${"x".repeat(150)}', 'F', 'G', 'D')`,
      );
      await importPanel(page).getByRole("status").getByText("7 Werte · 7 neu · 7 gesamt").waitFor();
      const previews = importPanel(page).locator("[data-sql-list-preview]");
      expect(await previews.count()).toBe(5);
      expect(await previews.last().textContent()).toBe(JSON.stringify(`${"x".repeat(120)}…`));
      await importPanel(page).getByText("… 2 weitere").waitFor();
      expect(await removed(page, "a,b").count()).toBe(0);
      await page.setViewportSize({ width: 310, height: 620 });
      await page.waitForFunction(() => {
        const panels = document.querySelectorAll(
          '[data-slot="popover-content"]:has([data-sql-list-preview]), [data-slot="popover-content"]:has(input[aria-label="Listenwert"])',
        );
        return (
          panels.length === 2 &&
          Array.from(panels).every((panel) => {
            const box = panel.getBoundingClientRect();
            return box.left >= 0 && box.right <= window.innerWidth;
          })
        );
      });
      await confirm(page).focus();
      await confirm(page).press("Enter");
      await source(page).waitFor({ state: "hidden" });
      await focused(valueInput(column));
      await removed(page, "O'Brien").waitFor();
      expect(await removed(page, "D").count()).toBe(1);
      await noQuery(page);

      await page.setViewportSize({ width: 1100, height: 820 });
      await apply(column).click();
      expect(await page.getByLabel("Applied filter").textContent()).toStartWith(
        `"name" IN ('O''Brien', 'a,b', '東京', 'D',`,
      );
      expect(await page.getByLabel("Raw SQL").textContent()).toBe("false");
      await noQuery(page, "1");
    } finally {
      await page.close();
    }
  },
  30_000,
);

run(
  "recognized paste in NOT IN returns focus, deduplicates and discards source on context changes",
  async () => {
    const page = await fixture();
    try {
      const column = await header(page, "name");
      await select(column, page, "ist nicht in Liste");
      const input = valueInput(column);
      await paste(input, "Berlin\nHamburg\tKöln;Bonn");
      await removed(page, "Köln").waitFor();
      await paste(input, "('Berlin', 'Berlin')");
      await importPanel(page).getByRole("status").getByText("1 Werte · 0 neu · 4 gesamt").waitFor();
      expect(await confirm(page).isDisabled()).toBe(true);
      await source(page).press("Escape");
      await source(page).waitFor({ state: "hidden" });
      await focused(input);

      await paste(input, "('Abbruch')");
      await importPanel(page).getByRole("button", { name: "Abbrechen", exact: true }).click();
      await source(page).waitFor({ state: "hidden" });
      await focused(input);
      expect(await removed(page, "Abbruch").count()).toBe(0);
      await noQuery(page);

      await paste(input, "('Wegwerfen', 'Berlin')");
      await source(page).waitFor();
      await select(column, page, "ist in Liste");
      await source(page).waitFor({ state: "hidden" });
      await sql(column).click();
      expect(await source(page).inputValue()).toBe("");
      await source(page).fill("('Nächste Spalte')");
      await source(page).press("Escape");
      await source(page).waitFor({ state: "hidden" });
      await page.keyboard.press("Escape");
      await column.waitFor({ state: "hidden" });

      const other = await header(page, "id");
      await select(other, page, "ist nicht in Liste");
      await paste(valueInput(other), "('1', 'a,b', 'O''Brien', '1')");
      expect(await source(page).inputValue()).toBe("('1', 'a,b', 'O''Brien', '1')");
      await importPanel(page).getByRole("status").getByText("3 Werte · 3 neu · 3 gesamt").waitFor();
      expect(await removed(page, "Wegwerfen").count()).toBe(0);
      expect(await removed(page, "Nächste Spalte").count()).toBe(0);
      await confirm(page).focus();
      await confirm(page).press("Space");
      await source(page).waitFor({ state: "hidden" });
      await focused(valueInput(other));
      expect(await removed(page, "1").count()).toBe(1);
      await noQuery(page);
      await apply(other).click();
      expect(await page.getByLabel("Applied filter").textContent()).toBe(
        `"id" NOT IN (1, 'a,b', 'O''Brien')`,
      );
      await noQuery(page, "1");
    } finally {
      await page.close();
    }
  },
  30_000,
);
