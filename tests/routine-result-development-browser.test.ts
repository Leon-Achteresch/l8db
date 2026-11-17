import { afterAll, beforeAll, expect, test } from "bun:test";
import { type Browser, chromium, type Page } from "playwright";
import type { QueryResult } from "../src/lib/db/types";

const url = process.env.L8DB_TABLE_BROWSER_URL;
const run = url ? test : test.skip;
let browser: Browser;
const longValue = `${"Schnee 雪 · ".repeat(4096)}END-A16`;

beforeAll(async () => {
  if (url) browser = await chromium.launch({ channel: process.env.L8DB_BROWSER_CHANNEL });
}, 30_000);
afterAll(async () => {
  await browser?.close();
});

type Fixture = {
  calls: { command: string; args?: Record<string, unknown> }[];
  finish: (result: QueryResult) => void;
  fail: (message: string) => void;
};

async function open() {
  const page = await browser.newPage();
  page.setDefaultTimeout(5000);
  await page.addInitScript(() => {
    const fixture: Fixture = { calls: [], finish: () => {}, fail: () => {} };
    Object.assign(window, {
      __routineFixture: fixture,
      __TAURI_INTERNALS__: {
        invoke: (command: string, args?: Record<string, unknown>) => {
          fixture.calls.push({ command, args });
          if (command === "routine_result_development_ready") return Promise.resolve(true);
          if (command === "routine_result_development_call")
            return new Promise((resolve, reject) => {
              fixture.finish = resolve;
              fixture.fail = (message) => reject(Error(message));
            });
          return Promise.reject(Error(`Unexpected command: ${command}`));
        },
      },
    });
  });
  await page.goto(`${url}/?routine-result-development=1`);
  await page.getByRole("heading", { name: "Isolierte Routinenprüfung" }).waitFor();
  return page;
}

const dialog = (page: Page) => page.getByRole("dialog", { name: /a16\.(fast|slow) ausführen/ });
const execute = (page: Page) =>
  dialog(page).getByRole("button", { name: "Ausführen", exact: true });
const result = (page: Page) => dialog(page).getByRole("region", { name: "Prozedurergebnis" });
const calls = (page: Page) =>
  page.evaluate(() => (window as unknown as { __routineFixture: Fixture }).__routineFixture.calls);
const focused = (page: Page) => page.locator(":focus");
const finish = (page: Page, details: string) =>
  page.evaluate(
    (value) => (window as unknown as { __routineFixture: Fixture }).__routineFixture.finish(value),
    {
      columns: ["details", "missing", "completed"],
      rows: [{ details, missing: null, completed: "1" }],
      rows_affected: null,
      execution_time_ms: 3,
    },
  );

run(
  "existing grid opens long and NULL values by keyboard and Escape restores focus",
  async () => {
    const page = await open();
    const trigger = page.getByRole("button", { name: "Schnelle Routine öffnen" });
    try {
      await trigger.focus();
      await page.keyboard.press("Enter");
      await execute(page).focus();
      await page.keyboard.press("Enter");
      await dialog(page).getByText("Wird ausgeführt…").waitFor();
      await finish(page, longValue);
      await result(page)
        .getByText(/1 Ergebniszeile/)
        .waitFor();
      const cell = result(page).locator('td[data-col="details"] button');
      expect((await cell.textContent())?.length).toBeLessThan(200);
      await cell.focus();
      await page.keyboard.press("Enter");
      const inspector = page.getByRole("dialog", { name: /Spalte: details/ });
      await inspector.waitFor();
      expect(await inspector.locator("pre").textContent()).toBe(longValue);
      expect(await inspector.getByRole("button", { name: "Bearbeiten" }).count()).toBe(0);
      await page.keyboard.press("Escape");
      await inspector.waitFor({ state: "hidden" });
      await page.waitForFunction(() => document.activeElement?.closest('td[data-col="details"]'));
      expect(await focused(page).getAttribute("title")).toBe("Vollständigen Zellwert anzeigen");

      const missing = result(page).locator('td[data-col="missing"] button');
      await missing.focus();
      await page.keyboard.press("Space");
      const nullInspector = page.getByRole("dialog", { name: /Spalte: missing/ });
      await nullInspector.getByText("NULL", { exact: true }).waitFor();
      await page.keyboard.press("Escape");
      await nullInspector.waitFor({ state: "hidden" });
      await page.keyboard.press("Escape");
      await dialog(page).waitFor({ state: "hidden" });
      await page.waitForFunction(
        () => document.activeElement?.textContent === "Schnelle Routine öffnen",
      );
      expect(await calls(page)).toEqual([
        { command: "routine_result_development_ready", args: {} },
        { command: "routine_result_development_call", args: { routine: "fast" } },
      ]);
    } finally {
      await page.close();
    }
  },
  30_000,
);

run(
  "pending is single-flight through close/reopen and context change; both stale success and failure disappear",
  async () => {
    const page = await open();
    try {
      await page.getByRole("button", { name: "Langsame Routine öffnen" }).click();
      await execute(page).evaluate((button: HTMLButtonElement) => {
        button.click();
        button.click();
      });
      await dialog(page).getByText("Wird ausgeführt…").waitFor();
      expect(await execute(page).isDisabled()).toBe(true);
      expect((await calls(page)).length).toBe(2);
      await page.keyboard.press("Escape");
      await dialog(page).waitFor({ state: "hidden" });
      await page.getByRole("button", { name: "Langsame Routine öffnen" }).click();
      await dialog(page).getByText("Vorheriger Aufruf läuft…").waitFor();
      expect(await execute(page).isDisabled()).toBe(true);
      await finish(page, "discard on close");
      await dialog(page).getByText("Vorheriger Aufruf läuft…").waitFor({ state: "hidden" });
      expect(await result(page).count()).toBe(0);

      await execute(page).click();
      await dialog(page).getByText("Wird ausgeführt…").waitFor();
      await page.keyboard.press("Alt+Shift+F");
      await page.getByRole("dialog", { name: "a16.fast ausführen" }).waitFor();
      await dialog(page).getByText("Vorheriger Aufruf läuft…").waitFor();
      expect(await execute(page).isDisabled()).toBe(true);
      await page.evaluate(() =>
        (window as unknown as { __routineFixture: Fixture }).__routineFixture.fail(
          "discard on context switch",
        ),
      );
      await dialog(page).getByText("Vorheriger Aufruf läuft…").waitFor({ state: "hidden" });
      expect(await result(page).count()).toBe(0);
      expect(await dialog(page).getByRole("alert").count()).toBe(0);

      await execute(page).click();
      await dialog(page).getByText("Wird ausgeführt…").waitFor();
      await finish(page, "current context");
      await result(page).getByText("current context", { exact: true }).waitFor();
      expect((await calls(page)).slice(1).map((call) => call.args)).toEqual([
        { routine: "slow" },
        { routine: "slow" },
        { routine: "fast" },
      ]);
    } finally {
      await page.close();
    }
  },
  30_000,
);
