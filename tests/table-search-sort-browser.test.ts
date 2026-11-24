import { expect, test } from "bun:test";
import { chromium, type Page } from "playwright";
import { seedDemoApp } from "./fixtures/demo-app";

const url = process.env.L8DB_FILTER_BROWSER_URL;

type SortWindow = {
  __rows: string[];
  __TAURI_INTERNALS__: { invoke: (command: string, args?: Record<string, unknown>) => unknown };
};

async function open(sorting: boolean) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors: string[] = [];
  page.on("pageerror", (error) => {
    if (error.message !== "ResizeObserver loop completed with undelivered notifications.")
      errors.push(error.message);
  });
  await seedDemoApp(page, { settings: { filterBarSorting: sorting, filterBarStyle: "pills" } });
  await page.addInitScript(() => {
    const state = window as unknown as SortWindow;
    state.__rows = [];
    const invoke = state.__TAURI_INTERNALS__.invoke;
    state.__TAURI_INTERNALS__.invoke = (command, args) => {
      if (command === "fetch_table_rows")
        state.__rows.push(
          [
            args?.table,
            args?.filter ?? "",
            args?.orderBy ?? "",
            args?.orderDesc ? "desc" : "asc",
          ].join("|"),
        );
      if (command === "list_all_columns")
        return args?.tableType === "VIEW"
          ? []
          : ["id", "customer", "status", "total"].map((name) => ({
              schema: "sales",
              table: "orders",
              name,
              data_type: "text",
            }));
      return invoke(command, args);
    };
  });
  await page.goto(`${url}/`);
  await page.getByRole("button", { name: "Verbinden", exact: true }).first().click();
  await page.getByRole("button", { name: "Erweiterte Suche" }).waitFor();
  return { browser, page, errors };
}

const lastRows = (page: Page) =>
  page.evaluate(() => (window as unknown as SortWindow).__rows.at(-1) ?? "");

async function eventually(read: () => Promise<unknown>, expected: unknown) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if ((await read()) === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  expect(await read()).toBe(expected);
}

async function selectOrders(page: Page) {
  await page.getByRole("button", { name: "Erweiterte Suche" }).click();
  const dialog = page.getByRole("dialog", { name: "Erweiterte Suche" });
  await dialog.waitFor();
  await dialog.getByText("orders", { exact: true }).first().click();
  await dialog.getByRole("button", { name: "Offnen" }).waitFor();
  return dialog;
}

test.skipIf(!url)(
  "die Tabellensuche bietet die Sortierung nur mit der Einstellung an",
  async () => {
    const { browser, page, errors } = await open(false);
    try {
      const dialog = await selectOrders(page);
      expect(await dialog.getByRole("button", { name: "Sortierung hinzufügen" }).count()).toBe(0);
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
  90_000,
);

test.skipIf(!url)(
  "die Tabellensuche öffnet die Tabelle mit Filter und gewählter Sortierung",
  async () => {
    const { browser, page, errors } = await open(true);
    try {
      let dialog = await selectOrders(page);
      await dialog.getByRole("button", { name: "Sortierung hinzufügen" }).click();
      await page
        .getByRole("radiogroup", { name: "Sortierrichtung" })
        .getByText("Absteigend")
        .click();
      await page.getByRole("combobox", { name: "Sortierspalte" }).click();
      await page.getByRole("option", { name: "total", exact: true }).click();
      await page.keyboard.press("Escape");
      await dialog
        .getByRole("button", { name: "Absteigend nach total – aufsteigend sortieren" })
        .waitFor();
      await dialog.getByRole("button", { name: "Offnen" }).click();
      await dialog.waitFor({ state: "detached" });
      await page.waitForURL(/\/tables\/sales\/orders/);
      await eventually(() => lastRows(page), "orders||total|desc");
      await page
        .getByRole("button", { name: "Absteigend nach total – aufsteigend sortieren" })
        .waitFor();
      await eventually(async () => new URL(page.url()).searchParams.has("fkSort"), false);
      await page.waitForTimeout(500);
      const requests = await page.evaluate(() => (window as unknown as SortWindow).__rows);
      console.log(`table search open with sort: ${JSON.stringify(requests)}`);
      expect(requests.length).toBeLessThanOrEqual(2);
      expect(requests.at(-1)).toBe("orders||total|desc");

      dialog = await selectOrders(page);
      expect(await dialog.locator('[data-filter-token="sort"]').count()).toBe(0);
      await dialog.getByRole("tab", { name: "SQL" }).click();
      await dialog.locator(".cm-content").fill("status = 'bezahlt'");
      await dialog.getByRole("button", { name: "Sortierung hinzufügen" }).click();
      await page.getByRole("combobox", { name: "Sortierspalte" }).click();
      await page.getByRole("option", { name: "customer", exact: true }).click();
      await page.keyboard.press("Escape");
      await dialog.getByRole("button", { name: "Offnen" }).click();
      await dialog.waitFor({ state: "detached" });
      await eventually(() => lastRows(page), "orders|status = 'bezahlt'|customer|asc");
      await page
        .getByRole("button", { name: "Aufsteigend nach customer – absteigend sortieren" })
        .waitFor();

      dialog = await selectOrders(page);
      await dialog.getByRole("tab", { name: "SQL" }).click();
      await dialog.locator(".cm-content").fill("status = 'offen'");
      await dialog.getByRole("button", { name: "Offnen" }).click();
      await dialog.waitFor({ state: "detached" });
      await eventually(() => lastRows(page), "orders|status = 'offen'||asc");
      expect(await page.locator('[data-filter-token="sort"]').count()).toBe(0);
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
  120_000,
);
