import { afterAll, beforeAll, expect, test } from "bun:test";
import { type Browser, chromium, type Page } from "playwright";
import { interactionPercentiles, measureAppClick } from "./fixtures/perf-app-interactions";

const url = process.env.L8DB_TABLE_BROWSER_URL;
const run = url ? test : test.skip;
const title = "pgvector-Referenz für PostgreSQL";
const menuLabel = "pgvector-Referenz…";
type Host = Window & {
  sqlFormatReviewFixture: {
    read: () => string;
    edit: (sql: string) => void;
    select: (start: number, end: number) => void;
    selection: () => string | undefined;
    hover: (offset: number) => Promise<void>;
    switchTab: () => void;
    setDatabase: (database: string) => void;
    setProvider: (id: "format-fixture" | "mysql" | null) => void;
  };
  referenceCalls: string[];
};
let browser: Browser;

beforeAll(async () => {
  if (url) browser = await chromium.launch({ channel: process.env.L8DB_BROWSER_CHANNEL });
}, 30_000);
afterAll(async () => {
  await browser?.close();
});

const toolbar = (page: Page) =>
  page.getByRole("button", { name: "Weitere Werkzeuge", exact: true });
const item = (page: Page) => page.getByRole("menuitem", { name: menuLabel, exact: true });
const dialog = (page: Page) => page.getByRole("dialog", { name: title });
const close = (page: Page) => dialog(page).getByRole("button", { name: "Schließen", exact: true });
const calls = (page: Page) => page.evaluate(() => (window as Host).referenceCalls);
const read = (page: Page) => page.evaluate(() => (window as Host).sqlFormatReviewFixture.read());
const selection = (page: Page) =>
  page.evaluate(() => (window as Host).sqlFormatReviewFixture.selection());
const edit = (page: Page, sql: string) =>
  page.evaluate((sql) => (window as Host).sqlFormatReviewFixture.edit(sql), sql);

async function openTools(page: Page) {
  await toolbar(page).press("Enter");
  await page.getByRole("menuitem", { name: "Editor-Werkzeuge", exact: true }).press("ArrowRight");
}

async function openReference(page: Page) {
  await openTools(page);
  await item(page).press("Enter");
  await dialog(page).waitFor();
}

async function fixture(width = 1100) {
  if (!url) throw Error("Missing isolated browser fixture");
  const context = await browser.newContext({
    viewport: { width, height: width < 500 ? 590 : 760 },
    colorScheme: width < 500 ? "dark" : "light",
    reducedMotion: "reduce",
  });
  try {
    const origin = new URL(url).origin;
    await context.route("**/*", (route) =>
      new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
    );
    await context.addInitScript(() => {
      const referenceCalls: string[] = [];
      Object.assign(window, {
        referenceCalls,
        __TAURI_INTERNALS__: {
          invoke: async (command: string) => {
            referenceCalls.push(command);
            if (/^(execute_|run_|stream_query)/.test(command))
              throw Error(`Unexpected execution: ${command}`);
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
    await page.goto(`${url}/tests/fixtures/sql-format-review.html?pgvector`);
    await page.locator("[data-fixture-query] .monaco-editor").first().waitFor();
    return { context, page, errors };
  } catch (error) {
    await context.close();
    throw error;
  }
}

run(
  "PostgreSQL editor reference explains three operators and returns keyboard focus without editing",
  async () => {
    const { context, page, errors } = await fixture(390);
    try {
      const sql = "SELECT a <-> b, a <#> b, a <=> b FROM fixture;";
      await edit(page, sql);
      await page.evaluate(() => (window as Host).sqlFormatReviewFixture.select(7, 14));
      expect(await selection(page)).toBe("a <-> b");
      const before = await calls(page);

      await openReference(page);
      await close(page).and(page.locator(":focus")).waitFor();
      const text = await dialog(page).innerText();
      for (const content of [
        "<->",
        "L2-Distanz",
        "<#>",
        "Negatives Skalarprodukt",
        "-(a <#> b)",
        "<=>",
        "Kosinusdistanz",
        "1 - (a <=> b)",
        "Kosinusähnlichkeit",
        "ORDER BY … ASC",
        "kleinsten Operatorergebnis",
        "bleiben ungeprüft",
      ])
        expect(text).toContain(content);
      const width = await dialog(page).evaluate((node) => ({
        x: node.getBoundingClientRect().x,
        right: node.getBoundingClientRect().right,
        overflow: node.scrollWidth > node.clientWidth,
      }));
      expect(width.x).toBeGreaterThanOrEqual(0);
      expect(width.right).toBeLessThanOrEqual(390);
      expect(width.overflow).toBe(false);
      if (process.env.L8DB_PGVECTOR_SCREENSHOT) {
        await dialog(page).screenshot({ path: process.env.L8DB_PGVECTOR_SCREENSHOT });
      }

      await page.evaluate(() => (window as Host).sqlFormatReviewFixture.select(16, 23));
      expect(await selection(page)).toBe("a <#> b");
      expect(await dialog(page).innerText()).toBe(text);
      await page.keyboard.press("Escape");
      await dialog(page).waitFor({ state: "hidden" });
      await toolbar(page).and(page.locator(":focus")).waitFor();
      expect(await read(page)).toBe(sql);
      expect(await selection(page)).toBe("a <#> b");
      expect(await calls(page)).toEqual(before);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  },
  40_000,
);

run(
  "operator hovers stay unclassified and reference closes across tab, database and provider changes",
  async () => {
    const { context, page, errors } = await fixture();
    try {
      const sql = "SELECT left_value <=> right_value, '<#>' AS literal; -- <->";
      await edit(page, sql);
      for (const operator of ["<=>", "<#>", "<->"]) {
        await page.evaluate(
          (offset) => (window as Host).sqlFormatReviewFixture.hover(offset),
          sql.indexOf(operator) + 1,
        );
        expect(await dialog(page).count()).toBe(0);
        expect(
          await page
            .locator(".monaco-hover")
            .getByText(/pgvector|Kosinusdistanz/)
            .count(),
        ).toBe(0);
        await page.keyboard.press("Escape");
      }

      await openReference(page);
      await page.evaluate(() => (window as Host).sqlFormatReviewFixture.switchTab());
      await dialog(page).waitFor({ state: "hidden" });
      expect(await read(page)).toBe("SELECT a <#> b FROM other;");
      await openReference(page);
      await page.evaluate(() => (window as Host).sqlFormatReviewFixture.setDatabase("second"));
      await dialog(page).waitFor({ state: "hidden" });
      await openReference(page);
      await page.evaluate(() => (window as Host).sqlFormatReviewFixture.setProvider("mysql"));
      await dialog(page).waitFor({ state: "hidden" });

      await openTools(page);
      expect(await item(page).count()).toBe(0);
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await page.evaluate(() => (window as Host).sqlFormatReviewFixture.setProvider(null));
      await openTools(page);
      expect(await item(page).count()).toBe(0);
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await page.evaluate(() =>
        (window as Host).sqlFormatReviewFixture.setProvider("format-fixture"),
      );
      expect(await dialog(page).count()).toBe(0);
      expect(await read(page)).toBe("SELECT a <#> b FROM other;");
      expect(
        (await calls(page)).filter((call) => /^(execute_|run_|stream_query)/.test(call)),
      ).toEqual([]);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  },
  40_000,
);

run(
  "reference stays small and request-free in an editor with a large SQL document",
  async () => {
    const { context, page, errors } = await fixture();
    try {
      const sql = "SELECT a <=> b AS distance FROM embeddings;\n".repeat(10_000);
      await edit(page, sql);
      const before = await calls(page);
      const samples: number[] = [];
      let descendants = 0;
      for (let index = 0; index < 8; index++) {
        await openTools(page);
        const ms = await measureAppClick(page, item(page), '[role="dialog"] dl');
        if (index > 1) samples.push(ms);
        descendants = Math.max(descendants, await dialog(page).locator("*").count());
        await close(page).press("Enter");
        await dialog(page).waitFor({ state: "hidden" });
        await toolbar(page).and(page.locator(":focus")).waitFor();
      }
      const timing = interactionPercentiles(samples);
      if (!process.env.CI) expect(timing.p95Ms).toBeLessThanOrEqual(250);
      expect(descendants).toBeLessThanOrEqual(35);
      expect(await read(page)).toBe(sql);
      await page.waitForTimeout(300);
      expect(await calls(page)).toEqual(before);
      expect(errors).toEqual([]);
      console.log("A42 pgvector reference", {
        documentBytes: sql.length,
        lines: 10_000,
        ...timing,
        descendants,
        additionalIpc: 0,
      });
    } finally {
      await context.close();
    }
  },
  45_000,
);
