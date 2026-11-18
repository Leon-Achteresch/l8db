import { afterAll, beforeAll, expect, test } from "bun:test";
import { type Browser, chromium, type Page } from "playwright";

const url = process.env.L8DB_TABLE_BROWSER_URL;
const run = url ? test : test.skip;
const text = "\uFEFFGrüße 東京 🧪\n<b>Nur Text</b>";
let browser: Browser;
beforeAll(async () => {
  if (url) browser = await chromium.launch({ channel: process.env.L8DB_BROWSER_CHANNEL });
}, 30_000);
afterAll(async () => {
  await browser?.close();
}, 15_000);

type Boundary = { ipc: string[]; copied: string[]; utf8: number[] };

async function fixture(width: number, colorScheme: "light" | "dark") {
  const context = await browser.newContext({ colorScheme, viewport: { width, height: 650 } });
  await context.addInitScript(() => {
    const boundary: Boundary = { ipc: [], copied: [], utf8: [] };
    const NativeDecoder = window.TextDecoder;
    window.TextDecoder = class extends NativeDecoder {
      decode(...args: Parameters<TextDecoder["decode"]>) {
        if (this.encoding === "utf-8" && this.fatal && this.ignoreBOM)
          boundary.utf8.push(args[0]?.byteLength ?? 0);
        return super.decode(...args);
      }
    };
    Object.assign(window, {
      binaryFixtureBoundary: boundary,
      __TAURI_INTERNALS__: {
        invoke: async (command: string, data: { text: string }) => {
          boundary.ipc.push(command);
          if (command !== "plugin:clipboard-manager|write_text")
            throw Error(`Unexpected fixture IPC: ${command}`);
          boundary.copied.push(data.text);
        },
      },
    });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(6500);
  await page.goto(`${url}/tests/fixtures/binary-utf8.html`, { timeout: 35_000 });
  await page.locator(`html.${colorScheme}`).waitFor();
  await page.getByRole("button", { name: "Binärwert öffnen" }).click();
  await page.getByRole("dialog").waitFor();
  return { context, page };
}

const mode = (page: Page, name: string) =>
  page.getByRole("dialog").getByRole("radio", { name, exact: true });
const preview = (page: Page) => page.getByRole("region", { name: "UTF-8-Text" }).locator("pre");
const hexDump = (page: Page) => page.getByTestId("hex-dump");
const change = (page: Page, detail: string) =>
  page.evaluate(
    (detail) => window.dispatchEvent(new CustomEvent("binary-fixture", { detail })),
    detail,
  );
const boundary = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { binaryFixtureBoundary: Boundary }).binaryFixtureBoundary,
  );

run(
  "the existing dialog only decodes after keyboard selection and retains the original copy formats",
  async () => {
    const { page, context } = await fixture(410, "dark");
    try {
      await hexDump(page).getByText("ASCII", { exact: true }).waitFor();
      expect(await mode(page, "Hex").getAttribute("aria-checked")).toBe("true");
      expect((await boundary(page)).utf8).toEqual([]);
      await mode(page, "Hex").focus();
      await page.keyboard.press("ArrowRight");
      await mode(page, "Base64").and(page.locator(":focus")).waitFor();
      await page.keyboard.press("ArrowRight");
      await mode(page, "UTF-8-Text").and(page.locator(":focus")).waitFor();
      expect((await boundary(page)).utf8).toEqual([]);
      await page.keyboard.press("Space");
      await preview(page).waitFor();
      expect(await preview(page).textContent()).toBe(text);
      expect(await preview(page).locator("b").count()).toBe(0);
      expect(await page.getByRole("dialog").locator("textarea,[contenteditable]").count()).toBe(0);
      expect((await boundary(page)).utf8).toEqual([Buffer.byteLength(text)]);
      const bounds = await page.getByRole("dialog").boundingBox();
      expect(bounds?.x ?? -1).toBeGreaterThanOrEqual(0);
      expect((bounds?.x ?? 0) + (bounds?.width ?? Infinity)).toBeLessThanOrEqual(410);
      await page
        .getByRole("dialog")
        .screenshot({ path: "test-artifacts/a29/utf8-narrow.png", animations: "disabled" });

      await page.getByRole("dialog").getByRole("button", { name: "Kopieren", exact: true }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Hex", exact: true }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Base64", exact: true }).click();
      expect((await boundary(page)).copied).toEqual([
        `\\x${Buffer.from(text).toString("hex")}`,
        Buffer.from(text).toString("hex"),
        Buffer.from(text).toString("base64"),
      ]);
      await mode(page, "UTF-8-Text").focus();
      await page.keyboard.press("ArrowLeft");
      await mode(page, "Base64").and(page.locator(":focus")).waitFor();
      await page.keyboard.press("Space");
      await page
        .getByRole("dialog")
        .getByText(Buffer.from(text).toString("base64"), { exact: true })
        .waitFor();
      await page.keyboard.press("ArrowLeft");
      await mode(page, "Hex").and(page.locator(":focus")).waitFor();
      await page.keyboard.press("Space");
      await hexDump(page).getByText("ASCII", { exact: true }).waitFor();
      expect((await boundary(page)).ipc).toEqual([
        "plugin:clipboard-manager|write_text",
        "plugin:clipboard-manager|write_text",
        "plugin:clipboard-manager|write_text",
      ]);
      await page.keyboard.press("Escape");
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      await page
        .getByRole("button", { name: "Binärwert öffnen" })
        .and(page.locator(":focus"))
        .waitFor();
    } finally {
      await context.close();
    }
  },
  60_000,
);

run(
  "another loaded value returns to Hex and has separate invalid, empty and over-limit states",
  async () => {
    const { page, context } = await fixture(900, "light");
    try {
      await mode(page, "UTF-8-Text").click();
      await preview(page).waitFor();
      await change(page, "invalid");
      await hexDump(page).waitFor();
      expect(await mode(page, "Hex").getAttribute("aria-checked")).toBe("true");
      expect((await boundary(page)).utf8).toEqual([Buffer.byteLength(text)]);
      await mode(page, "UTF-8-Text").click();
      await page
        .getByRole("status")
        .filter({ hasText: "Die Bytes sind kein gültiges UTF-8." })
        .waitFor();
      expect(await preview(page).count()).toBe(0);
      await change(page, "empty");
      await mode(page, "Hex").and(page.locator('[aria-checked="true"]')).waitFor();
      await mode(page, "UTF-8-Text").click();
      await page.getByRole("status").filter({ hasText: "Keine Bytes (leerer Wert)" }).waitFor();
      await change(page, "limit");
      await hexDump(page).waitFor();
      await mode(page, "UTF-8-Text").click();
      await page.getByRole("status").filter({ hasText: "bis zu 256 KB" }).waitFor();
      expect((await boundary(page)).utf8).toEqual([Buffer.byteLength(text), 2]);
      expect((await boundary(page)).ipc).toEqual([]);
      await change(page, "text");
      await hexDump(page).waitFor();
      expect(await preview(page).count()).toBe(0);
    } finally {
      await context.close();
    }
  },
  60_000,
);
