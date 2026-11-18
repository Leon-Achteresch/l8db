import { afterAll, beforeAll, expect, test } from "bun:test";
import { type Browser, chromium, type Page } from "playwright";
import { interactionPercentiles, measureAppClick } from "./fixtures/perf-app-interactions";

const url = process.env.L8DB_TABLE_BROWSER_URL;
const run = url ? test : test.skip;
const dialog = (page: Page) => page.getByRole("dialog", { name: "Objektsuche" });
const term = (page: Page) => dialog(page).getByRole("textbox", { name: "Suchtext" });
const results = (page: Page) => dialog(page).getByRole("list", { name: "Kommentartreffer" });
type FixtureHost = Window & {
  commentSearchCalls: string[];
  changeObjectSearchScope: (scope: "alpha" | "beta" | "other") => void;
  renameObjectSearchTable: () => void;
  setRenamedTableComment: () => void;
};
let browser: Browser;

beforeAll(async () => {
  if (url) browser = await chromium.launch({ channel: process.env.L8DB_BROWSER_CHANNEL });
}, 30_000);
afterAll(async () => {
  await browser?.close();
}, 15_000);

async function fixture(large = false, width = 1050) {
  const context = await browser.newContext({
    colorScheme: width < 500 ? "dark" : "light",
    viewport: { width, height: 760 },
    reducedMotion: "reduce",
  });
  try {
    await context.addInitScript(() => {
      const commentSearchCalls: string[] = [];
      Object.assign(window, {
        commentSearchCalls,
        __TAURI_INTERNALS__: {
          invoke: async (command: string) => {
            commentSearchCalls.push(command);
            if (command === "search_columns")
              return [
                {
                  schema: "public",
                  table: "orders",
                  column: "order_id",
                  data_type: "integer",
                  object_type: "BASE TABLE",
                },
              ];
            return [];
          },
        },
      });
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${url}/tests/fixtures/object-comment-search.html${large ? "?large=1" : ""}`);
    await page.getByRole("button", { name: "Objektsuche öffnen" }).click();
    await dialog(page).waitFor();
    return { context, page, errors };
  } catch (error) {
    await context.close();
    throw error;
  }
}

const calls = (page: Page) => page.evaluate(() => (window as FixtureHost).commentSearchCalls);
const switchScope = (page: Page, scope: "alpha" | "beta" | "other") =>
  page.evaluate((next) => (window as FixtureHost).changeObjectSearchScope(next), scope);
const comments = (page: Page) => dialog(page).getByRole("tab", { name: "Kommentare" });

run(
  "column name search and comment navigation keep their original keyboard and IPC paths",
  async () => {
    const { context, page, errors } = await fixture(false, 390);
    try {
      expect(await term(page).evaluate((input) => input === document.activeElement)).toBe(true);
      await term(page).fill("order_id");
      const columnNameResult = dialog(page).getByRole("button", {
        name: /order_id.*public.orders/,
      });
      await columnNameResult.waitFor();
      expect(await calls(page)).toContain("search_columns");
      await columnNameResult.press("Enter");
      await dialog(page).waitFor({ state: "detached" });
      expect(await page.getByLabel("Navigationsziel").textContent()).toBe("public.orders.order_id");
      await page.getByRole("button", { name: "Objektsuche öffnen" }).click();
      await dialog(page).waitFor();
      const before = await calls(page);
      await dialog(page).getByRole("tab", { name: "Spalten" }).press("End");
      await page.waitForFunction(
        () =>
          document.activeElement?.textContent?.includes("Kommentare") &&
          document.activeElement.getAttribute("aria-selected") === "true",
      );
      await term(page).fill("Zuständigkeit");
      const match = results(page).getByRole("button", {
        name: /public.orders.*owner.*Spaltenkommentar/,
      });
      await match.waitFor();
      const screenshot = process.env.L8DB_OBJECT_SEARCH_SCREENSHOT;
      if (screenshot) await page.screenshot({ path: screenshot });
      const box = await dialog(page).boundingBox();
      expect(box?.x).toBeGreaterThanOrEqual(0);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390);
      for (let index = 0; index < 5; index++) {
        if (await match.evaluate((el) => el === document.activeElement)) break;
        await page.keyboard.press("Tab");
      }
      expect(await match.evaluate((el) => el === document.activeElement)).toBe(true);
      await page.keyboard.press("Enter");
      await dialog(page).waitFor({ state: "detached" });
      expect(await page.getByLabel("Navigationsziel").textContent()).toBe("public.orders.owner");
      expect(await calls(page)).toEqual(before);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  },
  35_000,
);

run(
  "same names, selected schema and changed connections never retarget comments",
  async () => {
    const { context, page, errors } = await fixture();
    try {
      const before = await calls(page);
      await comments(page).click();
      await term(page).fill("beleg");
      await results(page).getByText("Beleg Rechnungswesen").waitFor();
      expect(await results(page).getByRole("button").count()).toBe(3);
      expect(await results(page).getByText("Tabellenkommentar").count()).toBe(2);
      await dialog(page).getByRole("combobox", { name: "Schema" }).click();
      await page.getByRole("option", { name: "billing" }).click();
      await results(page).getByText("Beleg Rechnungswesen").waitFor();
      expect(await results(page).getByRole("button").count()).toBe(1);
      expect(await results(page).innerText()).toContain("billing.orders");

      await switchScope(page, "beta");
      await results(page).getByText("Beleg Beta-Lager").waitFor();
      expect(await results(page).getByRole("button").count()).toBe(1);
      await switchScope(page, "alpha");
      await results(page).getByText("Beleg Rechnungswesen").waitFor();
      await switchScope(page, "other");
      await results(page).getByText("Beleg andere Datenbank").waitFor();
      expect(await results(page).getByRole("button").count()).toBe(1);
      await page.evaluate(() => (window as FixtureHost).changeObjectSearchScope("beta"));
      await results(page).getByText("Beleg Beta-Lager").waitFor();
      expect(await calls(page)).toEqual(before);
      await page.keyboard.press("Escape");
      await dialog(page).waitFor({ state: "detached" });
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  },
  35_000,
);

run(
  "cached rename deletes old source and target, and long comments yield a bounded excerpt",
  async () => {
    const { context, page, errors } = await fixture();
    try {
      const before = await calls(page);
      await comments(page).click();
      await term(page).fill("Randmarker");
      const marker = results(page).getByText(/Randmarker/);
      await marker.waitFor();
      expect((await marker.textContent())?.length).toBeLessThanOrEqual(182);
      await term(page).fill("HinterGrenze");
      await dialog(page).getByText("Keine passenden geladenen Kommentare.").waitFor();
      await term(page).fill("Beleg");
      await results(page).getByText("Beleg Kundenaufträge").waitFor();
      await page.evaluate(() => (window as FixtureHost).renameObjectSearchTable());
      await results(page).getByText("Beleg Kundenaufträge").waitFor({ state: "detached" });
      expect(await results(page).getByRole("button").count()).toBe(1);
      await page.evaluate(() => (window as FixtureHost).setRenamedTableComment());
      const renamed = results(page).getByRole("button", {
        name: /public.incoming.*Tabellenkommentar/,
      });
      await renamed.waitFor();
      expect(await renamed.textContent()).toContain("Beleg neue Tabelle");
      await renamed.press("Enter");
      await dialog(page).waitFor({ state: "detached" });
      expect(await page.getByLabel("Navigationsziel").textContent()).toBe("public.incoming");
      expect(await calls(page)).toEqual(before);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  },
  35_000,
);

async function measureEdit(page: Page, text: string) {
  const paint = page.evaluate(
    (text) =>
      new Promise<number>((resolve, reject) => {
        let started: number | undefined;
        const selector = '[aria-label="Kommentartreffer"] button';
        const start = (event: Event) => {
          if ((event.target as HTMLElement | null)?.id === "object-search-term")
            started = performance.now();
        };
        const clear = () => {
          observer.disconnect();
          document.removeEventListener("input", start, true);
          clearTimeout(timeout);
        };
        const observer = new MutationObserver(() => {
          if (
            started === undefined ||
            !document.querySelector(selector)?.textContent?.includes(text)
          )
            return;
          const from = started;
          clear();
          requestAnimationFrame(() => resolve(performance.now() - from));
        });
        const timeout = setTimeout(() => {
          clear();
          reject(new Error("Kommentartreffer blieben aus"));
        }, 5000);
        document.addEventListener("input", start, true);
        observer.observe(document.body, { childList: true, characterData: true, subtree: true });
      }),
    text,
  );
  const [elapsed, typed] = await Promise.allSettled([paint, term(page).fill(text)]);
  if (typed.status === "rejected") throw typed.reason;
  if (elapsed.status === "rejected") throw elapsed.reason;
  return elapsed.value;
}

run(
  "bounded comment search stays local across repeated edits in a large loaded catalog",
  async () => {
    const { context, page, errors } = await fixture(true);
    try {
      const before = await calls(page);
      const openMs = await measureAppClick(page, comments(page), '[aria-label="Kommentartreffer"]');
      expect(openMs).toBeLessThanOrEqual(250);
      const samples: number[] = [];
      let dom = 0;
      for (let index = 0; index < 8; index++) {
        const latency = await measureEdit(page, index % 2 === 0 ? "BatchRot" : "BatchBlau");
        if (index > 1) samples.push(latency);
        expect(await results(page).getByRole("button").count()).toBe(60);
        dom = Math.max(dom, await results(page).locator("*").count());
      }
      expect(await dialog(page).getByText("Erste 60 Treffer. Suchtext eingrenzen.").count()).toBe(
        1,
      );
      const latency = interactionPercentiles(samples);
      expect(dom).toBeLessThan(720);
      expect(latency.p95Ms).toBeLessThanOrEqual(250);
      await page.waitForTimeout(300);
      expect(await calls(page)).toEqual(before);
      await page.keyboard.press("Escape");
      await dialog(page).waitFor({ state: "detached" });
      expect(errors).toEqual([]);
      console.log("A18 Kommentarsuche", {
        ...latency,
        openMs,
        tables: 700,
        loadedComments: 1400,
        matchesShown: 60,
        maxResultDescendants: dom,
        additionalRequests: 0,
      });
    } finally {
      await context.close();
    }
  },
  45_000,
);
