import { expect, test } from "bun:test";
import { chromium, type Page, webkit } from "playwright";

const url = process.env.L8DB_PALETTE_BROWSER_URL;

function activeLabel(page: Page) {
  return page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>('[role="combobox"], input');
    const id = input?.getAttribute("aria-activedescendant");
    return id ? (document.getElementById(id)?.textContent ?? null) : null;
  });
}

for (const engine of [chromium, webkit]) {
  test.skipIf(!url)(
    `${engine.name()}: a resting pointer does not steal the highlight while typing`,
    async () => {
      const browser = await engine.launch({ headless: true });
      try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
        await page.goto(`${url}/tests/fixtures/command-palette-pointer.html`);
        const input = page.getByRole("combobox");
        await input.waitFor();
        await page.waitForTimeout(300);
        const options = page.getByRole("option");
        const box = await options.nth(4).boundingBox();
        if (!box) throw new Error("Option geometry is unavailable");
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.waitForTimeout(100);
        expect(await activeLabel(page)).toBe(await options.nth(4).textContent());

        for (const term of ["o", "or", "ord", "orders", "c", "cu", "customers_1", ""]) {
          await input.fill(term);
          await page.waitForTimeout(150);
          expect(await activeLabel(page)).toBe(await options.first().textContent());
        }
        await page.keyboard.press("ArrowDown");
        await page.keyboard.press("ArrowDown");
        await page.waitForTimeout(150);
        expect(await activeLabel(page)).toBe(await options.nth(2).textContent());
        await input.press("Enter");
        expect(await page.evaluate(() => document.body.dataset.selected)).toBe("item-2");

        await page.goto(`${url}/tests/fixtures/command-palette-pointer.html`);
        await input.waitFor();
        await page.waitForTimeout(300);
        const target = await options.nth(3).boundingBox();
        if (!target) throw new Error("Option geometry is unavailable");
        await page.mouse.move(target.x + 20, target.y + target.height / 2);
        await page.mouse.move(target.x + 40, target.y + target.height / 2);
        await page.waitForTimeout(100);
        expect(await activeLabel(page)).toBe(await options.nth(3).textContent());
      } finally {
        await browser.close();
      }
    },
    30_000,
  );
}
