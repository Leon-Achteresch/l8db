import { expect, test } from "bun:test";
import { chromium, webkit } from "playwright";

const url = process.env.L8DB_FILTER_BROWSER_URL;

for (const engine of [chromium, webkit]) {
  test.skipIf(!url)(
    `${engine.name()}: kompakter SQL-Editor behält Eingabe und Befehle`,
    async () => {
      const browser = await engine.launch({ headless: true });
      try {
        const page = await browser.newPage({ viewport: { width: 1100, height: 820 } });
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.goto(`${url}/tests/fixtures/compact-sql-editor.html`);
        const content = page.locator(".cm-editor .cm-content");
        await content.waitFor();
        expect(await content.textContent()).toContain("select id from users");
        await content.click();
        await page.keyboard.press("ControlOrMeta+a");
        await page.keyboard.insertText("select name from users");
        expect(await page.getByLabel("Editorwert").textContent()).toBe("select name from users");
        await page.keyboard.press("ControlOrMeta+Enter");
        expect(await page.getByLabel("Ausführungen").textContent()).toBe("1");
        await page.getByRole("button", { name: "Extern ändern" }).click();
        expect(await content.textContent()).toContain("select 1");
        await page.getByRole("button", { name: "Schreibschutz" }).click();
        await content.click();
        await page.keyboard.insertText("blocked");
        expect(await page.getByLabel("Editorwert").textContent()).toBe("select 1");
        await page.getByRole("button", { name: "Schreibschutz" }).click();
        await content.click();
        await page.keyboard.press("ControlOrMeta+a");
        await page.keyboard.insertText("select id from users");
        await page.keyboard.press("Shift+Alt+f");
        await page.waitForFunction(
          () =>
            document.querySelector(".cm-content")?.textContent?.startsWith("SELECT") &&
            document.querySelector('[aria-label="Editorwert"]')?.textContent?.startsWith("SELECT"),
        );
        expect(await page.getByLabel("Editorwert").textContent()).toMatch(
          /SELECT\s+id\s+FROM\s+users/,
        );
        await content.click();
        await page.keyboard.press("ControlOrMeta+a");
        await page.keyboard.insertText("na");
        await page.keyboard.press("Control+Space");
        await page.locator(".cm-tooltip-autocomplete").getByText("name", { exact: true }).waitFor();
        expect(errors).toEqual([]);
      } finally {
        await browser.close();
      }
    },
    60000,
  );
}
