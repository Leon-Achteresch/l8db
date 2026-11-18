import { afterAll, beforeAll, expect, test } from "bun:test";
import { type Browser, chromium, type Page } from "playwright";
import type { ActiveTransaction } from "../src/lib/transactions";
import { interactionPercentiles, measureAppClick } from "./fixtures/perf-app-interactions";

const url = process.env.L8DB_TABLE_BROWSER_URL;
const run = url ? test : test.skip;
type Transaction = Pick<ActiveTransaction, "txId" | "database" | "scope">;
type Call = { command: string; txId?: string };
type Host = Window & {
  postgresReadContextFixture: {
    setTransactions: (transactions: Transaction[]) => void;
    seedPreviousResult: () => void;
    finish: (txId: string, commit: boolean) => Promise<void>;
  };
  sqlFormatReviewFixture: {
    read: () => string;
    edit: (sql: string) => void;
    setDatabase: (database: string) => void;
    setProvider: (provider: string) => void;
    switchTab: () => void;
  };
  transactionContextCalls: Call[];
  releaseFinishing?: () => void;
  finishing?: Promise<void>;
};

let browser: Browser;
beforeAll(async () => {
  if (url) browser = await chromium.launch({ channel: process.env.L8DB_BROWSER_CHANNEL });
}, 30_000);
afterAll(async () => {
  await browser?.close();
}, 15_000);

const toolbar = (page: Page) => page.getByRole("button", { name: "Weitere Werkzeuge" });
const item = (page: Page) =>
  page.getByRole("menuitem", { name: "PostgreSQL-Lesekontext…", exact: true });
const dialog = (page: Page) => page.getByRole("dialog", { name: "PostgreSQL-Lesekontext" });
const status = (page: Page, text: string) => dialog(page).getByText(text, { exact: true });
const assigned = "Verwaltete Transaktion zugeordnet";
const finalizing = "Verwaltete Transaktion wird abgeschlossen";
const unassigned = "Keine verwaltete Transaktion zugeordnet";
const storedResult = "Transaktionszuordnung unbekannt";
const calls = (page: Page) => page.evaluate(() => (window as Host).transactionContextCalls);
const setTransactions = (page: Page, transactions: Transaction[]) =>
  page.evaluate((transactions) => {
    (window as Host).postgresReadContextFixture.setTransactions(transactions);
  }, transactions);
const currentTransaction: Transaction = {
  txId: "tx-current",
  database: "format",
  scope: { type: "query" },
};

async function openTools(page: Page) {
  await toolbar(page).press("Enter");
  await page.getByRole("menuitem", { name: "Editor-Werkzeuge", exact: true }).press("ArrowRight");
}

async function openHelp(page: Page) {
  await openTools(page);
  await item(page).press("Enter");
  await dialog(page).waitFor();
}

async function dismissHelp(page: Page) {
  await page.keyboard.press("Escape");
  await dialog(page).waitFor({ state: "hidden" });
  await toolbar(page).and(page.locator(":focus")).waitFor();
}

async function fixture(width: number) {
  if (!url) throw Error("Missing isolated browser fixture");
  const context = await browser.newContext({
    viewport: { width, height: 700 },
    colorScheme: width < 500 ? "dark" : "light",
    reducedMotion: "reduce",
  });
  try {
    const origin = new URL(url).origin;
    await context.route("**/*", (route) =>
      new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
    );
    await context.addInitScript(() => {
      const host = window as Host;
      host.transactionContextCalls = [];
      Object.assign(host, {
        __TAURI_INTERNALS__: {
          invoke: async (command: string, args?: { txId?: string }) => {
            host.transactionContextCalls.push({ command, txId: args?.txId });
            if (command === "commit_transaction" || command === "rollback_transaction")
              await new Promise<void>((resolve) => {
                host.releaseFinishing = resolve;
              });
            return [];
          },
        },
      });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(7500);
    const errors: string[] = [];
    page.on("pageerror", (error) => {
      if (error.message !== "ResizeObserver loop completed with undelivered notifications.")
        errors.push(error.message);
    });
    await page.goto(`${url}/tests/fixtures/sql-format-review.html?postgres-transaction`);
    await page.locator(".monaco-editor").first().waitFor();
    return { context, page, errors };
  } catch (failure) {
    await context.close();
    throw failure;
  }
}

function finish(page: Page, txId: string, commit: boolean) {
  return page.evaluate(
    ({ txId, commit }) => {
      const host = window as Host;
      host.releaseFinishing = undefined;
      host.finishing = host.postgresReadContextFixture.finish(txId, commit);
    },
    { txId, commit },
  );
}

function confirmFinish(page: Page) {
  return page.evaluate(async () => {
    const host = window as Host;
    if (!host.releaseFinishing) throw Error("No pending fixture transaction");
    host.releaseFinishing();
    await host.finishing;
  });
}

run(
  "keyboard help follows confirmed commit and rollback but cannot attribute the previous result",
  async () => {
    const { context, page, errors } = await fixture(390);
    try {
      await page.evaluate(() => (window as Host).postgresReadContextFixture.seedPreviousResult());
      await page.getByText("Voriger Stand", { exact: true }).waitFor();
      await setTransactions(page, [currentTransaction]);
      const baseline = await calls(page);
      await openHelp(page);
      await status(page, assigned).waitFor();
      await status(page, "Unbekannt").waitFor();
      await status(page, storedResult).waitFor();
      await dialog(page)
        .getByRole("button", { name: "Schließen" })
        .and(page.locator(":focus"))
        .waitFor();
      const box = await dialog(page).boundingBox();
      expect(box?.x).toBeGreaterThanOrEqual(0);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390);
      if (process.env.L8DB_POSTGRES_READ_CONTEXT_SCREENSHOT)
        await dialog(page).screenshot({ path: process.env.L8DB_POSTGRES_READ_CONTEXT_SCREENSHOT });

      for (const commit of [true, false]) {
        await setTransactions(page, [currentTransaction]);
        await status(page, assigned).waitFor();
        await finish(page, currentTransaction.txId, commit);
        await status(page, finalizing).waitFor();
        await status(page, storedResult).waitFor();
        await confirmFinish(page);
        await status(page, unassigned).waitFor();
        await status(page, "Unbekannt").waitFor();
        await status(page, storedResult).waitFor();
      }
      await dismissHelp(page);
      await page.getByText("Voriger Stand", { exact: true }).waitFor();
      expect((await calls(page)).slice(baseline.length)).toEqual([
        { command: "commit_transaction", txId: "tx-current" },
        { command: "rollback_transaction", txId: "tx-current" },
      ]);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  },
  35_000,
);

run(
  "an editor switch closes the help and a late finish stays in its original database scope",
  async () => {
    const { context, page, errors } = await fixture(1050);
    try {
      await page.evaluate(() => (window as Host).postgresReadContextFixture.seedPreviousResult());
      const tableTransaction: Transaction = {
        txId: "tx-table",
        database: "other",
        scope: { type: "table", schema: "public", table: "items" },
      };
      const connectionTransaction: Transaction = {
        txId: "tx-connection",
        database: "other",
        scope: { type: "connection" },
      };
      await setTransactions(page, [currentTransaction, tableTransaction, connectionTransaction]);
      await openHelp(page);
      await status(page, storedResult).waitFor();
      await finish(page, "tx-current", false);
      await status(page, finalizing).waitFor();
      await page.evaluate(() => (window as Host).sqlFormatReviewFixture.switchTab());
      await dialog(page).waitFor({ state: "hidden" });
      await openHelp(page);
      await status(page, finalizing).waitFor();
      expect(await status(page, storedResult).count()).toBe(0);
      await page.evaluate(() => (window as Host).sqlFormatReviewFixture.setDatabase("other"));
      await dialog(page).waitFor({ state: "hidden" });
      await openHelp(page);
      await status(page, assigned).waitFor();
      await confirmFinish(page);
      await status(page, assigned).waitFor();
      await setTransactions(page, [tableTransaction, currentTransaction]);
      await status(page, unassigned).waitFor();
      await status(page, "Unbekannt").waitFor();
      await page.evaluate(() => (window as Host).sqlFormatReviewFixture.setProvider("mysql"));
      await dialog(page).waitFor({ state: "hidden" });
      await openTools(page);
      expect(await item(page).count()).toBe(0);
      expect(
        (await calls(page)).filter(({ command }) => /^(execute_|run_|stream_query)/.test(command)),
      ).toEqual([]);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  },
  35_000,
);

run(
  "large SQL and unrelated transactions keep help bounded without background IPC",
  async () => {
    const { context, page, errors } = await fixture(1050);
    try {
      const source = "SELECT value FROM entries WHERE id = 42;\n".repeat(10_000);
      await page.evaluate((sql) => (window as Host).sqlFormatReviewFixture.edit(sql), source);
      await setTransactions(page, [
        ...Array.from({ length: 128 }, (_, index) => ({
          txId: String(index),
          database: `fixture-${index}`,
        })),
        currentTransaction,
      ]);
      const baseline = await calls(page);
      const samples: number[] = [];
      let nodes = 0;
      for (let index = 0; index < 8; index++) {
        await openTools(page);
        const ms = await measureAppClick(page, item(page), '[role="dialog"] dl');
        if (index > 1) samples.push(ms);
        nodes = Math.max(nodes, await dialog(page).locator("*").count());
        await status(page, assigned).waitFor();
        await dismissHelp(page);
      }
      const timing = interactionPercentiles(samples);
      expect(nodes).toBeLessThanOrEqual(20);
      expect(timing.p95Ms).toBeLessThanOrEqual(250);
      await page.waitForTimeout(300);
      expect(await calls(page)).toEqual(baseline);
      expect(await page.evaluate(() => (window as Host).sqlFormatReviewFixture.read())).toBe(
        source,
      );
      expect(errors).toEqual([]);
      console.log("A31 browser", {
        sqlLines: 10_000,
        transactions: 129,
        ...timing,
        nodes,
        helpIpc: 0,
      });
    } finally {
      await context.close();
    }
  },
  45_000,
);
