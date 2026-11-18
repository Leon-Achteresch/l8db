import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { type Browser, chromium, type Page } from "playwright";
import { formatSqlWith, type SqlFormatOptions } from "../src/lib/sql-format";
import { interactionPercentiles, measureAppClick } from "./fixtures/perf-app-interactions";

const url = process.env.L8DB_TABLE_BROWSER_URL;
const run = url ? test : test.skip;
const options: SqlFormatOptions = {
  dialect: "transactsql",
  tabWidth: 4,
  keywordCase: "upper",
  linesBetweenQueries: 1,
  denseOperators: true,
  newlineBeforeSemicolon: false,
};
const statement = "select [id], [via] from [orders] where [id] = 42;";
const heading = "SQL-Formatierung vergleichen";
type Fixture = {
  read: () => string;
  focused: () => boolean;
  setEol: (crlf: boolean) => void;
  edit: (sql: string) => void;
  select: (start: number, end: number) => void;
  compare: () => [string, string] | null;
  switchTab: () => void;
};
type Host = Window & { sqlFormatReviewFixture: Fixture; sqlFormatCalls: string[] };

let browser: Browser;
beforeAll(async () => {
  if (url) browser = await chromium.launch({ channel: process.env.L8DB_BROWSER_CHANNEL });
}, 30_000);
afterAll(async () => {
  await browser?.close();
}, 15_000);

async function fixture(width = 1280, colorScheme: "dark" | "light" = "dark", holdWorker = false) {
  const context = await browser.newContext({ colorScheme, viewport: { width, height: 820 } });
  let release: () => void = () => undefined;
  if (holdWorker) {
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await context.route("**/sql-format-worker.ts*", async (route) => {
      await gate;
      await route.continue().catch(() => undefined);
    });
  }
  await context.addInitScript(() => {
    const calls: string[] = [];
    Object.assign(window, {
      sqlFormatCalls: calls,
      __TAURI_INTERNALS__: {
        invoke: async (command: string) => {
          calls.push(command);
          if (/^(execute_|run_|stream_query)/.test(command))
            throw Error(`Unexpected SQL execution: ${command}`);
          return [];
        },
      },
    });
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => {
    if (error.message !== "ResizeObserver loop completed with undelivered notifications.")
      errors.push(error.message);
  });
  page.setDefaultTimeout(7500);
  await page.goto(`${url}/tests/fixtures/sql-format-review.html`, { timeout: 45_000 });
  await page.locator("[data-fixture-query] .monaco-editor").first().waitFor();
  return { context, page, errors, release };
}

const dialog = (page: Page) => page.getByRole("dialog", { name: heading });
const apply = (page: Page) => dialog(page).getByRole("button", { name: "Übernehmen", exact: true });
const cancel = (page: Page) => dialog(page).getByRole("button", { name: "Abbrechen", exact: true });
const read = (page: Page) => page.evaluate(() => (window as Host).sqlFormatReviewFixture.read());
const edit = (page: Page, sql: string) =>
  page.evaluate((text) => (window as Host).sqlFormatReviewFixture.edit(text), sql);
const select = (page: Page, start: number, end: number) =>
  page.evaluate(([start, end]) => (window as Host).sqlFormatReviewFixture.select(start, end), [
    start,
    end,
  ] as const);
const calls = (page: Page) => page.evaluate(() => (window as Host).sqlFormatCalls);

async function chooseTool(page: Page, name: string | RegExp) {
  await page.getByRole("button", { name: "Weitere Werkzeuge", exact: true }).click();
  await page.getByRole("menuitem", { name: "Editor-Werkzeuge" }).press("ArrowRight");
  await page.getByRole("menuitem", { name, exact: true }).click();
}

async function waitReady(page: Page) {
  await apply(page).and(page.locator(":enabled")).waitFor();
}

run(
  "selection review uses configured dialect and applies once with a single undo",
  async () => {
    const { context, page, errors } = await fixture(548, "dark");
    try {
      const prefix = "-- untouched header\n";
      const suffix = "\n-- untouched footer";
      const sql = prefix + statement + suffix;
      const expected = formatSqlWith(statement, options).sql;
      await edit(page, sql);
      await select(page, prefix.length, prefix.length + statement.length);
      const before = await calls(page);
      await chooseTool(page, /Formatierung vergleichen/);
      await waitReady(page);
      expect(await dialog(page).innerText()).toContain("Transact-SQL · Auswahl");
      expect(await page.evaluate(() => (window as Host).sqlFormatReviewFixture.compare())).toEqual([
        statement,
        expected,
      ]);
      expect(await read(page)).toBe(sql);
      expect(await cancel(page).evaluate((node) => node === document.activeElement)).toBe(true);
      expect(await dialog(page).evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(
        true,
      );
      await mkdir("test-artifacts/browser", { recursive: true });
      await page.screenshot({ path: "test-artifacts/browser/sql-format-review.png" });
      await apply(page).click();
      await dialog(page).waitFor({ state: "hidden" });
      expect(await read(page)).toBe(prefix + expected + suffix);
      await page.waitForFunction(() => (window as Host).sqlFormatReviewFixture.focused());
      await page.keyboard.press("ControlOrMeta+z");
      expect(await read(page)).toBe(sql);
      expect(await calls(page)).toEqual(before);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  },
  65_000,
);

run(
  "cancel, identical text, errors, selection change, revision change and editor switch never apply",
  async () => {
    const { context, page, errors } = await fixture();
    try {
      const expected = formatSqlWith(statement, options).sql;
      await edit(page, statement);
      await chooseTool(page, /Formatierung vergleichen/);
      await waitReady(page);
      await page.keyboard.press("Escape");
      await dialog(page).waitFor({ state: "hidden" });
      expect(await read(page)).toBe(statement);

      await chooseTool(page, "SQL formatieren");
      await page.waitForFunction(
        (sql) => (window as Host).sqlFormatReviewFixture.read() === sql,
        expected,
      );
      await chooseTool(page, /Formatierung vergleichen/);
      await dialog(page).getByText("Der Text bleibt gleich.").waitFor();
      expect(await apply(page).isDisabled()).toBe(true);
      await cancel(page).click();
      expect(await read(page)).toBe(expected);

      await page.evaluate(() => (window as Host).sqlFormatReviewFixture.setEol(true));
      await chooseTool(page, /Formatierung vergleichen/);
      await dialog(page).getByText("Der Text bleibt gleich.").waitFor();
      expect(await apply(page).isDisabled()).toBe(true);
      await cancel(page).click();
      expect(await read(page)).toBe(expected.replaceAll("\n", "\r\n"));
      await page.evaluate(() => (window as Host).sqlFormatReviewFixture.setEol(false));

      await edit(page, "select 'broken");
      await chooseTool(page, /Formatierung vergleichen/);
      expect(await dialog(page).getByRole("alert").innerText()).toContain(
        "Nicht abgeschlossenes Literal",
      );
      expect(await apply(page).isDisabled()).toBe(true);
      expect(await read(page)).toBe("select 'broken");
      await cancel(page).click();

      await edit(page, statement);
      await chooseTool(page, /Formatierung vergleichen/);
      await waitReady(page);
      await select(page, 0, 9);
      await select(page, 0, 0);
      await dialog(page)
        .getByText(/Die Vorschau ist veraltet/)
        .waitFor();
      expect(await apply(page).isDisabled()).toBe(true);
      expect(await read(page)).toBe(statement);
      await cancel(page).click();

      await chooseTool(page, /Formatierung vergleichen/);
      await waitReady(page);
      await edit(page, `${statement}\n-- changed`);
      await dialog(page)
        .getByText(/Die Vorschau ist veraltet/)
        .waitFor();
      expect(await apply(page).isDisabled()).toBe(true);
      expect(await read(page)).toBe(`${statement}\n-- changed`);
      await cancel(page).click();

      await chooseTool(page, /Formatierung vergleichen/);
      await waitReady(page);
      await page.evaluate(() => (window as Host).sqlFormatReviewFixture.switchTab());
      await dialog(page).waitFor({ state: "hidden" });
      await page.waitForFunction(
        () => (window as Host).sqlFormatReviewFixture.read() === "select [other] from [items];",
      );
      expect((await calls(page)).some((call) => /^(execute_|run_|stream_query)/.test(call))).toBe(
        false,
      );
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  },
  65_000,
);

run(
  "a superseded cold formatter request can be discarded before a fresh review",
  async () => {
    const { context, page, errors, release } = await fixture(1280, "dark", true);
    try {
      await edit(page, statement);
      await chooseTool(page, /Formatierung vergleichen/);
      await dialog(page).getByText("SQL wird formatiert…").waitFor();
      await edit(page, "select [new] from [orders]");
      await dialog(page)
        .getByText(/Die Vorschau ist veraltet/)
        .waitFor();
      await cancel(page).click();
      release();
      await chooseTool(page, /Formatierung vergleichen/);
      await waitReady(page);
      expect(await read(page)).toBe("select [new] from [orders]");
      expect(
        await page.evaluate(() => (window as Host).sqlFormatReviewFixture.compare()?.[0]),
      ).toBe("select [new] from [orders]");
      await cancel(page).click();
      expect(errors).toEqual([]);
    } finally {
      release();
      await context.close();
    }
  },
  65_000,
);

run(
  "warm 300-statement previews keep bounded DOM and zero additional database requests",
  async () => {
    const { context, page, errors } = await fixture(1440, "light");
    try {
      const sql = Array.from(
        { length: 300 },
        (_, index) => `select [id], [value] from [orders] where [id] = ${index};`,
      ).join("\n");
      await edit(page, sql);
      const before = await calls(page);
      const samples: number[] = [];
      let maxNodes = 0;
      for (let index = 0; index < 8; index++) {
        await page.getByRole("button", { name: "Weitere Werkzeuge", exact: true }).click();
        await page.getByRole("menuitem", { name: "Editor-Werkzeuge" }).press("ArrowRight");
        const elapsed = await measureAppClick(
          page,
          page.getByRole("menuitem", { name: /Formatierung vergleichen/ }),
          '[data-slot="sql-format-diff"] textarea',
        );
        await waitReady(page);
        if (index > 1) samples.push(elapsed);
        if (index === 0) {
          expect(await dialog(page).getByRole("textbox", { name: "Original" }).inputValue()).toBe(
            sql,
          );
          expect(await dialog(page).getByRole("textbox", { name: "Formatiert" }).inputValue()).toBe(
            formatSqlWith(sql, options).sql,
          );
        }
        const nodes = await dialog(page).locator("*").count();
        maxNodes = Math.max(maxNodes, nodes);
        await cancel(page).click();
        await dialog(page).waitFor({ state: "hidden" });
        expect(await page.locator('[data-slot="sql-format-diff"]').count()).toBe(0);
      }
      const latency = interactionPercentiles(samples);
      expect(latency.p95Ms).toBeLessThanOrEqual(500);
      expect(maxNodes).toBeLessThan(3000);
      await page.waitForTimeout(300);
      expect(await calls(page)).toEqual(before);
      expect(await read(page)).toBe(sql);
      console.log("A34 Formatvorschau", {
        ...latency,
        statements: 300,
        inputCharacters: sql.length,
        maxNodes,
        additionalRequests: 0,
      });
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  },
  70_000,
);
