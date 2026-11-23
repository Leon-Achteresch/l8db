import { afterAll, beforeAll, expect, test } from "bun:test";
import { type Browser, chromium, type Page } from "playwright";

const url = process.env.L8DB_TABLE_BROWSER_URL;
const run = url ? test : test.skip;
const fixture = `${url}/tests/fixtures/table-record.html`;
const title = "Datensatz";
let browser: Browser;

beforeAll(async () => {
  if (url) browser = await chromium.launch({ channel: process.env.L8DB_BROWSER_CHANNEL });
}, 30_000);
afterAll(async () => {
  await browser?.close();
}, 15_000);

async function openFixture(width: number, colorScheme: "light" | "dark") {
  const context = await browser.newContext({ colorScheme, viewport: { width, height: 420 } });
  await context.addInitScript(() => {
    const calls: string[] = [];
    Object.assign(window, {
      recordIpc: calls,
      __TAURI_INTERNALS__: {
        invoke: async (command: string) => {
          calls.push(command);
          throw Error(`Unexpected fixture IPC: ${command}`);
        },
      },
    });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  page.on("pageerror", (error) => console.error("Record fixture:", error.message));
  await page.goto(fixture, { timeout: 35_000 });
  await page.getByRole("grid", { name: "Daten" }).getByTitle("Kopieren", { exact: true }).waitFor();
  await page.locator(`html.${colorScheme}`).waitFor();
  return { page, context };
}

const grid = (page: Page) => page.getByRole("grid", { name: "Daten" });
const record = (page: Page) => page.getByRole("dialog", { name: title, exact: true });
const fields = (page: Page) => record(page).getByRole("table", { name: "Felder" });
const values = (page: Page, name: string) =>
  fields(page)
    .getByRole("row")
    .filter({ has: page.getByRole("rowheader", { name, exact: true }) })
    .getByRole("cell");
const calls = (page: Page) =>
  page.evaluate(() => (window as unknown as { recordIpc: string[] }).recordIpc);
const setScope = (page: Page, detail: string) =>
  page.evaluate(
    (detail) => window.dispatchEvent(new CustomEvent("record-fixture", { detail })),
    detail,
  );
const waitForGridFocus = (page: Page) => grid(page).and(page.locator(":focus")).waitFor();

run(
  "the row menu opens one loaded record with typed values in a narrow window",
  async () => {
    const { page, context } = await openFixture(320, "dark");
    try {
      const origin = grid(page).getByRole("button", { name: "Zeile 41 markieren" });
      await origin.focus();
      await origin.click({ button: "right" });
      const menu = page.getByRole("menuitem", { name: /Datensatz anzeigen/ });
      await menu.focus();
      await page.keyboard.press("Enter");
      await record(page).getByText("Zeile 41 · 1200 Felder").waitFor();
      expect(await fields(page).getAttribute("aria-rowcount")).toBe("1200");
      expect(await values(page, "Name").textContent()).toBe("Inventur Nord");
      expect(await values(page, "Fehlend").textContent()).toBe("Nicht geladen");
      expect(await values(page, "Leer").textContent()).toBe("Leerer Text");
      expect(await values(page, "Nullwert").textContent()).toBe("NULL");
      expect(await values(page, "Aktiv").textContent()).toBe("false");
      expect(await values(page, "Genauer Betrag").textContent()).toBe(
        "9\u202f007\u202f199\u202f254\u202f740\u202f993.125",
      );
      expect(await values(page, "Zeitpunkt").textContent()).toBe("2026-11-18 10:34:56 UTC");
      expect(await values(page, "Notiz").textContent()).toBe("Zeile eins\nZeile zwei");
      expect(await values(page, "Struktur").textContent()).toContain("lagersaldo: [4, 8]");
      expect(await values(page, "Feld 10").textContent()).toBe(`${"x".repeat(500)}…`);
      expect(await record(page).locator("input, textarea, [contenteditable]").count()).toBe(0);
      const bounds = await record(page).boundingBox();
      expect(bounds?.x).toBeGreaterThanOrEqual(0);
      expect((bounds?.x ?? 0) + (bounds?.width ?? Infinity)).toBeLessThanOrEqual(320);
      expect(bounds?.y).toBeGreaterThanOrEqual(0);
      expect((bounds?.y ?? 0) + (bounds?.height ?? Infinity)).toBeLessThanOrEqual(420);
      await record(page).screenshot({
        path: "test-artifacts/a22/record-narrow.png",
        animations: "disabled",
      });
      await page.keyboard.press("Escape");
      await record(page).waitFor({ state: "hidden" });
      await origin.and(page.locator(":focus")).waitFor();
      expect(await calls(page)).toEqual([]);
    } finally {
      await context.close();
    }
  },
  65_000,
);

run(
  "keyboard navigation, keyless records and changing the loaded row or table stay scoped",
  async () => {
    const { page, context } = await openFixture(960, "light");
    try {
      await grid(page).focus();
      await page.keyboard.press("Alt+Enter");
      await values(page, "Name")
        .filter({ hasText: /^Inventur Nord$/ })
        .waitFor();
      await setScope(page, "replace-row");
      await record(page).waitFor({ state: "hidden" });
      await waitForGridFocus(page);
      await page.keyboard.press("Alt+Enter");
      await values(page, "Name")
        .filter({ hasText: /^Inventur Nord neu$/ })
        .waitFor();
      await page.keyboard.press("Escape");
      await waitForGridFocus(page);
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Alt+Enter");
      await values(page, "Name")
        .filter({ hasText: /^Inventur Süd$/ })
        .waitFor();
      await record(page).getByText("Zeile 42 · 1200 Felder").waitFor();
      await page.keyboard.press("Escape");
      await waitForGridFocus(page);
      await grid(page).getByText("Inventur Süd", { exact: true }).click({ button: "right" });
      await page.getByRole("menuitem", { name: /Datensatz anzeigen/ }).click();
      await values(page, "Name")
        .filter({ hasText: /^Inventur Süd$/ })
        .waitFor();
      await setScope(page, "switch-table");
      await record(page).waitFor({ state: "hidden" });
      await grid(page).getByText("Katalog West", { exact: true }).waitFor();
      await grid(page).focus();
      await page.keyboard.press("Alt+Enter");
      await values(page, "Name")
        .filter({ hasText: /^Katalog West$/ })
        .waitFor();
      await record(page).getByText("Zeile 1 · 1200 Felder").waitFor();
      expect(await calls(page)).toEqual([]);
    } finally {
      await context.close();
    }
  },
  65_000,
);

run(
  "1200 loaded fields keep the mounted rows bounded and open within the local browser budget",
  async () => {
    const { page, context } = await openFixture(960, "light");
    try {
      const times: number[] = [];
      let maximumMounted = 0;
      await grid(page).focus();
      for (let run = 0; run < 11; run++) {
        const start = performance.now();
        await page.keyboard.press("Alt+Enter");
        await values(page, "Name").waitFor();
        if (run >= 2) times.push(performance.now() - start);
        maximumMounted = Math.max(
          maximumMounted,
          await fields(page).locator("tr[data-index]").count(),
        );
        if (run === 0) {
          const scroller = record(page).getByRole("region", { name: "Feldliste" });
          await scroller.focus();
          await page.keyboard.press("End");
          await values(page, "Feld 1200").filter({ hasText: "Letztes Feld · Nord" }).waitFor();
          maximumMounted = Math.max(
            maximumMounted,
            await fields(page).locator("tr[data-index]").count(),
          );
          expect(
            await scroller.evaluate((element) => element.scrollWidth <= element.clientWidth),
          ).toBe(true);
        }
        await page.keyboard.press("Escape");
        await waitForGridFocus(page);
        expect(await record(page).count()).toBe(0);
      }
      times.sort((a, b) => a - b);
      const median = times[4];
      const p95 = times[8];
      console.log(
        `A22 browser: 1200 fields, 9 samples, median=${median.toFixed(2)}ms p95=${p95.toFixed(2)}ms mounted=${maximumMounted} ipc=${(await calls(page)).length}`,
      );
      expect(maximumMounted).toBeLessThan(45);
      expect(median).toBeLessThan(150);
      expect(p95).toBeLessThan(300);
      expect(await calls(page)).toEqual([]);
    } finally {
      await context.close();
    }
  },
  60_000,
);
