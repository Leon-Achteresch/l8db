import { expect, test } from "bun:test";
import { chromium, webkit } from "playwright";

const url = process.env.L8DB_SELECT_BROWSER_URL;

for (const engine of [chromium, webkit]) {
  for (const query of ["", "?selected"]) {
    test.skipIf(!url)(
      `${engine.name()}: morphing dialog select stays anchored during search ${query}`,
      async () => {
        const browser = await engine.launch({ headless: true });
        try {
          const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
          await page.goto(`${url}/tests/fixtures/select-search.html${query}`);
          await page.getByRole("button", { name: "Vergleich einrichten" }).click();
          const trigger = page.locator('[data-slot="select-trigger"]');
          await trigger.click();
          const search = page.getByPlaceholder("Suchen…");
          await search.waitFor();
          await page.waitForTimeout(200);
          for (const term of ["L", "Lober", "missing", ""]) {
            await search.fill(term);
            await page.waitForTimeout(200);
            const anchor = await trigger.boundingBox();
            const content = await page.locator('[data-slot="select-content"]').boundingBox();
            if (!anchor || !content) throw new Error("Select geometry is unavailable");
            expect(Math.abs(content.x - anchor.x)).toBeLessThan(20);
            expect(content.x + content.width).toBeLessThanOrEqual(1280);
            if (term === "Lober") expect(await page.getByRole("option").count()).toBe(2);
            if (term === "missing")
              expect(await page.getByText("Keine Treffer").isVisible()).toBe(true);
          }
          await search.fill("Lober");
          await page.screenshot({
            path: `/tmp/l8db-select-${engine.name()}${query ? "-selected" : ""}.png`,
          });
          await page.getByRole("option", { name: "LOBERON_TEST", exact: true }).click();
          expect(await trigger.innerText()).toContain("LOBERON_TEST");
          await search.waitFor({ state: "hidden" });
          await trigger.click();
          await search.fill("ECO");
          await page.getByRole("option", { name: "ECO_TEST", exact: true }).click();
          expect(await trigger.innerText()).toContain("ECO_TEST");
        } finally {
          await browser.close();
        }
      },
      30_000,
    );
  }
}
