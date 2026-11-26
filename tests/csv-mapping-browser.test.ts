import { expect, test } from "bun:test";
import { chromium, webkit } from "playwright";

const url = process.env.L8DB_CSV_MAPPING_BROWSER_URL;
for (const engine of [chromium, webkit]) {
  test.skipIf(!url)(
    `${engine.name()}: offene Zuordnungen filtern und letzte Spalte zuweisen`,
    async () => {
      const browser = await engine.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await page.goto(`${url}/tests/fixtures/csv-mapping.html`);
        const filter = page.getByRole("button", { name: /Nur ohne Zielspalte/ });
        await filter.waitFor();
        expect(await page.getByRole("combobox").count()).toBe(20);
        await filter.click();
        expect(await page.getByRole("combobox").count()).toBe(1);
        const trigger = page.getByRole("combobox", { name: "Zielspalte für Spalte_119" });
        await trigger.click();
        const search = page.getByRole("textbox", { name: "Optionen durchsuchen" });
        await search.fill("Spalte_119");
        await page.getByRole("option", { name: /Spalte_119/ }).click();
        await page.getByText("Alle Quellspalten sind zugeordnet.").waitFor();
        expect(await page.getByRole("combobox").count()).toBe(0);
        await filter.click();
        const next = page.getByRole("button", { name: "Nächste Spalten" });
        for (let i = 0; i < 5; i++) await next.click();
        expect(await next.isDisabled()).toBe(true);
        expect(await trigger.innerText()).toContain("Spalte_119");
        expect(await page.getByRole("combobox").count()).toBe(20);
      } finally {
        await browser.close();
      }
    },
    45000,
  );
}
