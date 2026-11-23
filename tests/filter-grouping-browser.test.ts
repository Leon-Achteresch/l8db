import { afterAll, beforeAll, expect, test } from "bun:test";
import { type Browser, chromium, type Page } from "playwright";
import { compileFilterConditions } from "../src/lib/sql-filter";
import { interactionPercentiles, measureAppClick } from "./fixtures/perf-app-interactions";

const url = process.env.L8DB_TABLE_BROWSER_URL;
const run = url ? test : test.skip;
const trigger = (page: Page) => page.getByRole("button", { name: "Gruppierung lesen" });
const preview = (page: Page) => page.getByRole("dialog", { name: "Logische Gruppierung" });
const editor = (page: Page) => page.locator(".cm-content");
const applies = (page: Page) => page.getByLabel("Apply count").textContent();
const calls = (page: Page) =>
  page.evaluate(() => (window as Window & { groupingCalls?: string[] }).groupingCalls ?? []);
let browser: Browser;

beforeAll(async () => {
  if (url) browser = await chromium.launch({ channel: process.env.L8DB_BROWSER_CHANNEL });
}, 30_000);

afterAll(async () => {
  await browser?.close();
}, 15_000);

async function fixture(query: string, width = 1140, colorScheme: "light" | "dark" = "light") {
  const context = await browser.newContext({
    colorScheme,
    reducedMotion: "reduce",
    viewport: { width, height: 680 },
  });
  try {
    await context.addInitScript(() => {
      const groupingCalls: string[] = [];
      Object.assign(window, {
        groupingCalls,
        __TAURI_INTERNALS__: {
          invoke: async (command: string) => {
            groupingCalls.push(command);
            return [];
          },
        },
      });
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(
      `${url}/tests/fixtures/filter-bar.html?grouping=1&theme=${colorScheme}&${query}`,
    );
    return { page, context, errors };
  } catch (error) {
    await context.close();
    throw error;
  }
}

async function edit(page: Page, sql: string) {
  await editor(page).fill(sql);
  expect(await editor(page).textContent()).toBe(sql);
}

async function close(page: Page) {
  await page.keyboard.press("Escape");
  await preview(page).waitFor({ state: "detached" });
}

async function classicSql(page: Page) {
  await page.getByRole("button", { name: "Filter", exact: true }).click();
  await page.getByRole("tab", { name: "SQL", exact: true }).click();
  await editor(page).waitFor();
}

run(
  "classic SQL filter reads mixed and nested groups before any separate apply",
  async () => {
    const { page, context, errors } = await fixture("style=classic", 390, "dark");
    try {
      await classicSql(page);
      const before = await calls(page);
      const expression = "id = 1 OR status = 'er AND ror' AND tokens > 1100";
      await edit(page, expression);
      await trigger(page).press("Enter");
      const group = preview(page);
      await group.waitFor();
      expect(await group.locator("[data-filter-group=OR] > ul > li").count()).toBe(2);
      expect(await group.locator("[data-filter-group=AND] code").allTextContents()).toEqual([
        "status = 'er AND ror'",
        "tokens > 1100",
      ]);
      expect(await group.evaluate((el) => el === document.activeElement)).toBe(true);
      const box = await group.boundingBox();
      expect(box).not.toBeNull();
      expect(box?.x).toBeGreaterThanOrEqual(0);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390);
      if (process.env.L8DB_FILTER_GROUPING_SCREENSHOT) {
        await page.screenshot({ path: process.env.L8DB_FILTER_GROUPING_SCREENSHOT });
      }
      expect(await applies(page)).toBe("0");
      await close(page);
      expect(await trigger(page).evaluate((el) => el === document.activeElement)).toBe(true);
      expect(await editor(page).textContent()).toBe(expression);
      expect(await calls(page)).toEqual(before);

      const nested = "(id = 1 OR id = 2) AND (tokens > 1 AND tokens < 0)";
      await edit(page, nested);
      await trigger(page).press("Space");
      await group.waitFor();
      expect(
        await group
          .locator("[data-filter-group=AND] [data-filter-group=OR] code")
          .allTextContents(),
      ).toEqual(["id = 1", "id = 2"]);
      expect(await group.locator("code").allTextContents()).toEqual([
        "id = 1",
        "id = 2",
        "tokens > 1",
        "tokens < 0",
      ]);
      expect(await applies(page)).toBe("0");
      await close(page);
      await page.getByRole("button", { name: "Filter anwenden" }).click();
      expect(await page.getByLabel("Applied filter").textContent()).toBe(nested);
      expect(await page.getByLabel("Raw SQL").textContent()).toBe("true");
      expect(await applies(page)).toBe("1");
      expect(await calls(page)).toEqual(before);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  },
  35_000,
);

run(
  "builder-generated SQL, unsupported draft, and genuine table scope switch stay separate",
  async () => {
    const { page, context, errors } = await fixture("style=omnibar");
    try {
      const simple = page.getByRole("combobox", { name: "Filter eingeben oder KI fragen" });
      await simple.fill("id = 42");
      await page.getByRole("option", { name: /Filter hinzufügen/ }).waitFor();
      await simple.press("Enter");
      const compiled = compileFilterConditions(
        [{ column: "id", operator: "eq", value: "42", dataType: "int4" }],
        "AND",
        "postgres",
      );
      expect(await page.getByLabel("Applied filter").textContent()).toBe(compiled);
      await page.getByRole("button", { name: "SQL", exact: true }).click();
      await editor(page).waitFor();
      const before = await calls(page);
      await trigger(page).click();
      expect(await preview(page).locator("code").allTextContents()).toEqual([compiled]);
      expect(await preview(page).locator("[data-filter-group]").count()).toBe(0);
      await close(page);

      const unsupported = "id = 1 OR lower(status) = 'ok'";
      await edit(page, unsupported);
      await trigger(page).click();
      await preview(page)
        .getByText(/Funktionsaufrufe.*Der Filtertext bleibt verfügbar/)
        .waitFor();
      expect(await preview(page).locator("code").count()).toBe(0);
      expect(await editor(page).textContent()).toBe(unsupported);
      await close(page);

      await edit(page, "id = 1 OR id = 2");
      await trigger(page).click();
      expect(await preview(page).locator("code").allTextContents()).toEqual(["id = 1", "id = 2"]);
      const changeTable = page.getByRole("button", { name: "Tabelle wechseln" });
      await changeTable.evaluate((el: HTMLButtonElement) => el.click());
      await preview(page).waitFor({ state: "detached" });
      await trigger(page).click();
      expect(await preview(page).locator("code").allTextContents()).toEqual([
        "tokens > 17",
        "id < 0",
      ]);
      expect(await applies(page)).toBe("1");
      expect(await calls(page)).toEqual(before);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  },
  35_000,
);

run(
  "provider without a verified grammar keeps its SQL editor and gives a concrete fallback",
  async () => {
    const { page, context, errors } = await fixture("style=pills&kind=mysql");
    try {
      await page.getByRole("button", { name: "SQL", exact: true }).click();
      const expression = "id = 1 OR id = 2 AND id = 3";
      await edit(page, expression);
      const before = await calls(page);
      await trigger(page).click();
      await preview(page)
        .getByText(/für PostgreSQL-SQL-Filter verfügbar/)
        .waitFor();
      expect(await preview(page).locator("code").count()).toBe(0);
      await close(page);
      expect(await editor(page).textContent()).toBe(expression);
      expect(await applies(page)).toBe("0");
      expect(await calls(page)).toEqual(before);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  },
  25_000,
);

run(
  "large filter previews retain bounded DOM and no requests before, during or after dismissal",
  async () => {
    const { page, context, errors } = await fixture("style=classic");
    try {
      await classicSql(page);
      const alternatives = 280;
      const sql = Array.from(
        { length: alternatives },
        (_, i) => `id = ${i} AND tokens > ${i + 4000}`,
      ).join(" OR ");
      await edit(page, sql);
      const before = await calls(page);
      const samples: number[] = [];
      let maxNodes = 0;
      for (let index = 0; index < 8; index++) {
        const elapsed = await measureAppClick(
          page,
          trigger(page),
          '[aria-label="Logische Gruppierung"] [data-filter-group="OR"]',
        );
        if (index > 1) samples.push(elapsed);
        const group = preview(page);
        await group.getByText("Weitere Bedingungen stehen im Filtertext.").waitFor();
        maxNodes = Math.max(maxNodes, await group.locator("*").count());
        if (index === 0) {
          await page.keyboard.press("PageDown");
          await page.waitForFunction(
            () =>
              (document.querySelector('[aria-label="Logische Gruppierung"]')?.scrollTop ?? 0) > 0,
          );
        }
        await close(page);
      }
      const latency = interactionPercentiles(samples);
      if (!process.env.CI) expect(latency.p95Ms).toBeLessThanOrEqual(250);
      expect(maxNodes).toBeLessThan(250);
      await page.waitForTimeout(300);
      expect(await calls(page)).toEqual(before);
      expect(await applies(page)).toBe("0");
      expect(await editor(page).textContent()).toBe(sql);
      console.log("A33 Filtergruppierung", {
        ...latency,
        alternatives,
        clauses: alternatives * 2,
        inputCharacters: sql.length,
        maxNodes,
        additionalRequests: 0,
      });
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  },
  40_000,
);
