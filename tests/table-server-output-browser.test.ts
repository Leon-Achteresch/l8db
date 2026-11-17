import { afterAll, beforeAll, expect, test } from "bun:test";
import { type Browser, chromium, type Page } from "playwright";
import type { ServerMessage } from "../src/lib/db";

const url = process.env.L8DB_TABLE_BROWSER_URL;
const run = url ? test : test.skip;
let browser: Browser;
beforeAll(async () => {
  if (url) browser = await chromium.launch({ channel: process.env.L8DB_BROWSER_CHANNEL });
}, 30_000);
afterAll(async () => {
  await browser?.close();
}, 15_000);

type Boundary = {
  calls: { command: string; args: Record<string, unknown> }[];
  clipboard: string[];
  finish?: (messages: ServerMessage[]) => void;
  fail?: () => void;
};

async function fixture() {
  const page = await browser.newPage({ viewport: { width: 1100, height: 820 } });
  page.setDefaultTimeout(5000);
  await page.addInitScript(() => {
    const boundary: Boundary = { calls: [], clipboard: [] };
    Object.assign(window, {
      __outputBoundary: boundary,
      __TAURI_INTERNALS__: {
        invoke: (command: string, args: Record<string, unknown> = {}) => {
          boundary.calls.push({ command, args });
          if (command === "set_server_output") return Promise.resolve();
          if (command === "transaction_server_output") {
            return new Promise((resolve, reject) => {
              boundary.finish = resolve;
              boundary.fail = () => reject(Error("synthetischer Lesefehler"));
            });
          }
          if (command === "plugin:clipboard-manager|write_text") {
            boundary.clipboard.push(String(args.text));
            return Promise.resolve();
          }
          return Promise.reject(Error(`Unexpected fixture IPC: ${command}`));
        },
      },
    });
  });
  await page.goto(`${url}/tests/fixtures/table-server-output.html`, { timeout: 20_000 });
  return page;
}

const dialog = (page: Page) => page.getByRole("dialog", { name: /^Server-Ausgabe/ });
const log = (page: Page) => dialog(page).getByRole("log", { name: "Ausgabe" });
const trigger = (page: Page) => page.getByRole("button", { name: /^Server-Ausgabe(?: · \d+)?$/ });
const capture = (page: Page) => dialog(page).getByRole("switch", { name: "Ausgabe aktiv" });
const operation = (page: Page) => page.getByRole("button", { name: "Grid-Erfolg auslösen" });
const query = (page: Page) => page.getByRole("region", { name: "Query-Ansicht" });
const calls = (page: Page) =>
  page.evaluate(() => (window as unknown as { __outputBoundary: Boundary }).__outputBoundary.calls);
const notice = (message: string, detail: string | null = null): ServerMessage => ({
  level: "NOTICE",
  message,
  detail,
});

async function finish(page: Page, messages: ServerMessage[]) {
  await page.waitForFunction(() =>
    Boolean((window as unknown as { __outputBoundary: Boundary }).__outputBoundary.finish),
  );
  await page.evaluate((items) => {
    const boundary = (window as unknown as { __outputBoundary: Boundary }).__outputBoundary;
    const finish = boundary.finish;
    delete boundary.finish;
    delete boundary.fail;
    finish?.(items);
  }, messages);
}

async function close(page: Page) {
  await page.keyboard.press("Escape");
  await dialog(page).waitFor({ state: "hidden" });
}

run(
  "table dialog enables explicitly and shows empty, success and neutral read failure",
  async () => {
    const page = await fixture();
    try {
      await trigger(page).focus();
      await page.keyboard.press("Enter");
      await log(page).getByText("Ausgabe ist aus").waitFor();
      await capture(page).and(page.locator(":focus")).waitFor();
      expect(await calls(page)).toEqual([]);
      const tip = await dialog(page).getAttribute("aria-describedby");
      expect(tip).toBeTruthy();
      expect(
        await page.evaluate((id) => id && document.getElementById(id)?.textContent, tip),
      ).toContain("Kein Commit-Nachweis.");
      expect(
        await dialog(page).getByRole("button", { name: "Ausgabe kopieren" }).isDisabled(),
      ).toBe(true);
      expect(await dialog(page).getByRole("button", { name: "Ausgabe leeren" }).isDisabled()).toBe(
        true,
      );
      await page.keyboard.press("Space");
      await log(page).getByText("Keine Ausgabe").waitFor();
      expect(await capture(page).getAttribute("aria-checked")).toBe("true");
      expect(await calls(page)).toEqual([
        {
          command: "set_server_output",
          args: {
            kind: "postgres",
            connectionString: "postgresql://synthetic.invalid/fixture",
            database: "alpha",
            enabled: true,
          },
        },
      ]);
      await close(page);
      await trigger(page).and(page.locator(":focus")).waitFor();
      await operation(page).click();
      await finish(page, [notice("Schreibhinweis", "Detailtext")]);
      await page.getByLabel("Grid-Ergebnis").getByText("alpha: Grid-Erfolg").waitFor();
      await trigger(page).click();
      await log(page).getByText("Detailtext").waitFor();
      await page
        .getByText("Verbindung und Datenbank, nicht nur diese Tabelle. Kein Commit-Nachweis.")
        .waitFor();
      await close(page);
      await operation(page).click();
      await page.evaluate(() => {
        (window as unknown as { __outputBoundary: Boundary }).__outputBoundary.fail?.();
      });
      await page
        .getByText("Server-Ausgabe konnte nicht gelesen werden.", { exact: true })
        .waitFor();
      await page.getByLabel("Grid-Operationen").getByText("2", { exact: true }).waitFor();
      expect(await page.getByLabel("Grid-Ergebnis").textContent()).toBe("alpha: Grid-Erfolg");
      await trigger(page).click();
      await log(page).getByText("Detailtext").waitFor();
      expect((await calls(page)).map(({ command }) => command)).toEqual([
        "set_server_output",
        "transaction_server_output",
        "transaction_server_output",
      ]);
    } finally {
      await page.close();
    }
  },
  35_000,
);

run(
  "late output stays with its original database, copy and clear are local, query remains connection-wide",
  async () => {
    const page = await fixture();
    try {
      await trigger(page).click();
      await capture(page).click();
      await log(page).getByText("Keine Ausgabe").waitFor();
      await close(page);
      await operation(page).click();
      await trigger(page).click();
      await log(page).getByText("Keine Ausgabe").waitFor();
      await page
        .getByRole("button", { name: "Beta", exact: true, includeHidden: true })
        .evaluate((button: HTMLButtonElement) => button.click());
      await dialog(page).waitFor({ state: "hidden" });
      await trigger(page).click();
      await page.getByRole("dialog", { name: "Server-Ausgabe · Fixture / beta" }).waitFor();
      await finish(page, [notice("Späte Alpha-Ausgabe")]);
      await log(page).getByText("Keine Ausgabe").waitFor();
      expect(await log(page).getByText("Späte Alpha-Ausgabe").count()).toBe(0);
      await close(page);
      await operation(page).click();
      await finish(page, [notice("Beta-Ausgabe", "Beta-Detail")]);
      await page.getByLabel("Grid-Ergebnis").getByText("beta: Grid-Erfolg").waitFor();
      await trigger(page).click();
      await log(page).getByText("Beta-Detail").waitFor();
      await dialog(page).getByRole("button", { name: "Ausgabe kopieren" }).press("Enter");
      expect(
        await page.evaluate(
          () => (window as unknown as { __outputBoundary: Boundary }).__outputBoundary.clipboard,
        ),
      ).toEqual(["NOTICE: Beta-Ausgabe — Beta-Detail"]);
      await dialog(page).getByRole("button", { name: "Ausgabe leeren" }).click();
      await log(page).getByText("Keine Ausgabe").waitFor();
      await close(page);
      expect(await query(page).getByRole("log").count()).toBe(0);
      await query(page).getByRole("tab", { name: "Query-Ausgabe 1" }).click();
      await query(page).getByRole("log").getByText("Späte Alpha-Ausgabe").waitFor();
      expect(await query(page).getByText("Beta-Detail").count()).toBe(0);
      await page.getByRole("button", { name: "Alpha", exact: true }).click();
      await trigger(page).click();
      await log(page).getByText("Späte Alpha-Ausgabe").waitFor();
      expect((await calls(page)).map(({ command }) => command)).toEqual([
        "set_server_output",
        "transaction_server_output",
        "transaction_server_output",
        "plugin:clipboard-manager|write_text",
      ]);
    } finally {
      await page.close();
    }
  },
  35_000,
);

run(
  "compact dialog and keyboard scroll keep 2,000 messages virtualized",
  async () => {
    const page = await fixture();
    try {
      await trigger(page).click();
      await capture(page).click();
      await log(page).getByText("Keine Ausgabe").waitFor();
      await close(page);
      await operation(page).click();
      await finish(
        page,
        Array.from({ length: 2000 }, (_, i) => notice(`Hinweis ${i + 1}`)),
      );
      await page.getByLabel("Grid-Ergebnis").getByText("alpha: Grid-Erfolg").waitFor();
      await page.setViewportSize({ width: 380, height: 420 });
      await trigger(page).click();
      await log(page).getByText("Hinweis 2000", { exact: true }).waitFor();
      await page.waitForFunction(() => {
        const rect = document
          .querySelector('[data-slot="dialog-content"]')
          ?.getBoundingClientRect();
        return rect && rect.top >= 0 && rect.bottom <= innerHeight;
      });
      const nodes = log(page).locator("[data-index]");
      expect(await nodes.count()).toBeLessThan(100);
      await capture(page).focus();
      await page.keyboard.press("Tab");
      await page.keyboard.press("Tab");
      await page.keyboard.press("Tab");
      await log(page).and(page.locator(":focus")).waitFor();
      await page.keyboard.press("Home");
      await log(page).getByText("Hinweis 1", { exact: true }).waitFor();
      expect(await nodes.count()).toBeLessThan(100);
      expect(await log(page).getByText("Hinweis 2000", { exact: true }).count()).toBe(0);
      await page.keyboard.press("End");
      await log(page).getByText("Hinweis 2000", { exact: true }).waitFor();
      const rendered = await nodes.count();
      expect(rendered).toBeLessThan(100);
      console.log(
        JSON.stringify({ outputEntries: 2000, renderedLogRows: rendered, viewport: [380, 420] }),
      );
      const idle = (await calls(page)).length;
      await page.waitForTimeout(100);
      expect(await calls(page)).toHaveLength(idle);
      await close(page);
      await trigger(page).and(page.locator(":focus")).waitFor();
    } finally {
      await page.close();
    }
  },
  35_000,
);
