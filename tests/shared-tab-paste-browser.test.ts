import { afterAll, beforeAll, expect, test } from "bun:test";
import type { Browser, Page } from "playwright";
import { chromium } from "playwright";
import { createServer, type ViteDevServer } from "vite";

const ENABLED = process.env.L8DB_SHARED_TAB_BROWSER === "1";
let server: ViteDevServer | undefined;
let browser: Browser | undefined;
let base = "";

beforeAll(async () => {
  if (!ENABLED) return;
  server = await createServer({
    cacheDir: "node_modules/.vite-shared-tab-paste",
    server: { host: "127.0.0.1", port: 0, strictPort: false, watch: null, hmr: false },
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") throw new Error("Fixture-Server startet nicht");
  base = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true });
}, 120_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

async function open(query = "") {
  if (!browser) throw new Error("Browser fehlt");
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${base}/tests/fixtures/shared-tab-paste.html${query}`);
  await page.waitForFunction(() => Boolean((window as { l8dbLink?: string }).l8dbLink));
  await page.waitForSelector("#page");
  return { page, errors };
}

async function paste(page: Page, selector: string | null, text: string) {
  return page.evaluate(
    ([target, value]) => {
      const element = target ? document.querySelector(target) : document.body;
      if (!element) throw new Error(`Ziel fehlt: ${target}`);
      const data = new DataTransfer();
      data.setData("text/plain", value);
      const event = new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: data,
      });
      return element.dispatchEvent(event);
    },
    [selector, text] as const,
  );
}

const dialog = (page: Page) => page.getByRole("dialog").filter({ hasText: "orders" });

const commands = (page: Page) =>
  page.evaluate(() => (window as { __calls?: string[] }).__calls ?? []);

const link = (page: Page) =>
  page.evaluate(() => (window as { l8dbLink?: string }).l8dbLink as string);

test.skipIf(!ENABLED)(
  "a link pasted outside fields opens a confirm dialog and runs nothing",
  async () => {
    const { page, errors } = await open();
    const text = await link(page);
    await page.locator("#page").click();
    await paste(page, null, text);
    await dialog(page).waitFor({ state: "visible" });
    await dialog(page).getByText("public.orders").waitFor({ state: "visible" });
    expect(await dialog(page).getByRole("button", { name: "Öffnen" }).isEnabled()).toBe(false);
    const started = (await commands(page)).filter((name) =>
      /fetch|query|execute|count|rows/i.test(name),
    );
    expect(started).toEqual([]);
    expect(errors).toEqual([]);
    await page.close();
  },
);

test.skipIf(!ENABLED)(
  "a link pasted into a text field stays plain text and opens nothing",
  async () => {
    const { page, errors } = await open();
    const text = await link(page);
    const handled = await paste(page, "#field", text);
    expect(handled).toBe(true);
    await page.waitForTimeout(100);
    expect(await dialog(page).count()).toBe(0);
    expect(errors).toEqual([]);
    await page.close();
  },
);

test.skipIf(!ENABLED)("a link pasted into the editor or grid is not intercepted", async () => {
  const { page } = await open();
  const text = await link(page);
  expect(await paste(page, "#editor", text)).toBe(true);
  await page.waitForTimeout(100);
  expect(await dialog(page).count()).toBe(0);
  await page.close();
});

test.skipIf(!ENABLED)(
  "plain text and malformed links show no dialog and no page error",
  async () => {
    const { page, errors } = await open();
    expect(await paste(page, null, "Hallo Welt, kein Link")).toBe(true);
    expect(await paste(page, null, "l8db://tab/")).toBe(true);
    expect(await paste(page, null, "l8db://tab/zzzz")).toBe(false);
    await page.waitForTimeout(150);
    expect(await dialog(page).count()).toBe(0);
    expect(errors).toEqual([]);
    await page.close();
  },
);

test.skipIf(!ENABLED)("a link pasted into the command palette offers to open it", async () => {
  const { page, errors } = await open("?palette=1");
  const text = await link(page);
  const input = page.locator("[role='dialog'] input[role='combobox']");
  await input.waitFor();
  await input.focus();
  expect(await paste(page, "[role='dialog'] input[role='combobox']", text)).toBe(false);
  await dialog(page).waitFor({ state: "visible" });
  expect(errors).toEqual([]);
  await page.close();
});
