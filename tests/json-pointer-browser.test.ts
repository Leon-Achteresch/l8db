import { expect, test } from "bun:test";
import { chromium, webkit } from "playwright";

const url = process.env.L8DB_JSON_POINTER_BROWSER_URL;
for (const engine of [chromium, webkit]) {
  test.skipIf(!url)(
    `${engine.name()}: JSON Pointer aus schreibgeschützter Zelle kopieren`,
    async () => {
      const browser = await engine.launch();
      try {
        const page = await browser.newPage();
        await page.addInitScript(() => {
          Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: {
              writeText: async (text: string) => {
                document.body.dataset.copied = text;
              },
            },
          });
        });
        await page.goto(`${url}/tests/fixtures/json-pointer.html`);
        const copy = page.getByRole("button", { name: "JSON Pointer kopieren" });
        await copy.click();
        await page.waitForFunction(() => document.body.dataset.copied === "");
        await page.getByText("Beispielwert", { exact: false }).first().click();
        await copy.click();
        await page.waitForFunction(() => document.body.dataset.copied === "/a~1b/x~01");
        const selected = page.locator('[data-selected="true"]');
        await selected.getByRole("button", { name: "Aktionen" }).click();
        await page.getByRole("menuitem", { name: "Kopieren als" }).hover();
        const menuItem = page.getByRole("menuitem", { name: "JSON Pointer kopieren" });
        await menuItem.waitFor();
        await page.evaluate(() => {
          delete document.body.dataset.copied;
        });
        await menuItem.click();
        await page.waitForFunction(() => document.body.dataset.copied === "/a~1b/x~01");
        expect(await page.getByTestId("json-editor").count()).toBe(1);
      } finally {
        await browser.close();
      }
    },
    45000,
  );
}
