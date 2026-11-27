import { expect, test } from "bun:test";
import { chromium, webkit } from "playwright";

const url = process.env.L8DB_S3_PAGINATION_BROWSER_URL;
for (const engine of [chromium, webkit]) {
  test.skipIf(!url)(
    `${engine.name()}: S3-Folgeseite erneut laden und Kreis erkennen`,
    async () => {
      const browser = await engine.launch();
      try {
        const page = await browser.newPage();
        await page.goto(`${url}/tests/fixtures/s3-pagination.html`);
        await page.getByText("Erster", { exact: true }).waitFor();
        await page.getByRole("button", { name: "Weitere laden" }).click();
        await page.getByRole("alert").filter({ hasText: "Verbindung unterbrochen" }).waitFor();
        expect(await page.getByText("Erster", { exact: true }).isVisible()).toBe(true);
        await page.getByRole("button", { name: "Erneut versuchen" }).click();
        await page.getByText("Zweiter", { exact: true }).waitFor();
        await page.getByText(/Liste unvollständig/).waitFor();
        expect(await page.getByRole("button", { name: "Weitere laden" }).count()).toBe(0);
        const all = page.getByRole("checkbox", { name: "Alle auswählen" });
        await page.getByRole("checkbox", { name: "Zweiter auswählen" }).click();
        expect(await all.isChecked()).toBe(false);
        const filter = page.getByRole("textbox", { name: "Objekte filtern" });
        await filter.fill("Zweiter");
        await page.getByText("Erster", { exact: true }).waitFor({ state: "hidden" });
        expect(await all.isChecked()).toBe(true);
        await filter.fill("Erster");
        await page.getByText("Erster", { exact: true }).waitFor();
        expect(await page.getByRole("button", { name: "Herunterladen" }).count()).toBe(0);
        await filter.fill("");
        await page.getByText("Zweiter", { exact: true }).waitFor();
        expect(await page.getByRole("checkbox", { name: "Zweiter auswählen" }).isChecked()).toBe(
          true,
        );
        await all.click();
        expect(await page.getByRole("checkbox", { name: "Erster auswählen" }).isChecked()).toBe(
          true,
        );
      } finally {
        await browser.close();
      }
    },
    45000,
  );
}
