import { expect, test } from "bun:test";
import { chromium } from "playwright";

test.skipIf(!process.env.L8DB_TABLE_BROWSER_URL)(
  "table grid: first click focuses, second click opens focused editor",
  async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
      viewport: { width: 1280, height: 820 },
    });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() => {
      window.__TAURI_INTERNALS__ = { invoke: async () => [] };
    });
    try {
      await page.goto(`${process.env.L8DB_TABLE_BROWSER_URL}/tests/fixtures/table-edit.html`);
      const cell = page.locator('tbody tr[data-index="1"] td[data-col="email"]');
      await cell.waitFor();
      await page.screenshot({ path: "/tmp/l8db-edit-0-idle.png" });

      await cell.click();
      await page.waitForTimeout(120);
      expect(await page.locator("tbody input").count()).toBe(0);
      await page.screenshot({ path: "/tmp/l8db-edit-1-focused.png" });

      await cell.click();
      const input = page.locator("tbody input").first();
      await input.waitFor();
      await page.waitForTimeout(120);
      expect(await input.evaluate((el) => el === document.activeElement)).toBe(true);
      await page.screenshot({ path: "/tmp/l8db-edit-2-editing.png" });

      await page.keyboard.type("changed@example.test");
      await page.keyboard.press("Enter");
      await page.getByText("changed@example.test", { exact: true }).waitFor();
      await page.waitForTimeout(200);
      expect(await page.evaluate(() => window.testSaves.length)).toBe(1);
      await page.screenshot({ path: "/tmp/l8db-edit-3-saved.png" });

      const other = page.locator('tbody tr[data-index="3"] td[data-col="city"]');
      await other.click();
      await page.waitForTimeout(120);
      expect(await page.locator("tbody input").count()).toBe(0);
      await other.click();
      await page.locator("tbody input").first().waitFor();
      await page.keyboard.press("Escape");
      await page.waitForTimeout(120);
      expect(await page.locator("tbody input").count()).toBe(0);
      await page.screenshot({ path: "/tmp/l8db-edit-4-escaped.png" });

      const idCell = page.locator('tbody tr[data-index="0"] td[data-col="id"]');
      await idCell.click();
      await page.locator('tbody tr[data-index="4"] td[data-col="city"]').click({
        modifiers: ["Shift"],
      });
      await page.waitForTimeout(120);
      expect(await page.locator("tbody input").count()).toBe(0);
      expect(await page.locator("td.bg-primary\\/10").count()).toBeGreaterThan(1);
      await page.screenshot({ path: "/tmp/l8db-edit-5-selection.png" });

      expect(errors).toEqual([]);
    } finally {
      await page.close();
      await browser.close();
    }
  },
  60000,
);
