import { expect, test } from "bun:test";
import { chromium, webkit } from "playwright";

const url = process.env.L8DB_FILTER_BROWSER_URL;

for (const engine of [chromium, webkit]) {
  test.skipIf(!url)(
    `${engine.name()}: imports filter expressions and keeps invalid drafts from replacing filters`,
    async () => {
      const browser = await engine.launch({ headless: true });
      try {
        const page = await browser.newPage({ viewport: { width: 1100, height: 820 } });
        const errors: string[] = [];
        page.on("pageerror", (error) => {
          const canceledHighlight =
            /^Canceled(?:: Canceled)?$/.test(error.message) &&
            (!error.stack ||
              (error.stack.includes("WordHighlighter") && error.stack.includes("Delayer")));
          if (!canceledHighlight) errors.push(error.stack || error.message);
        });
        await page.addInitScript(() => {
          Object.assign(window, { __TAURI_INTERNALS__: { invoke: async () => [] } });
        });
        await page.goto(`${url}/tests/fixtures/filter-list.html`);
        await page.getByRole("button", { name: "Filter", exact: true }).click();
        const input = page.getByRole("textbox", { name: "Filterausdruck", exact: true });
        const apply = page.getByRole("button", { name: "Filter anwenden", exact: true });
        await input.fill(`"name" = '''ANG'''`);
        await input.press("Enter");
        expect(await page.getByPlaceholder("Wert", { exact: true }).inputValue()).toBe("ANG");
        expect(await page.getByLabel("Apply count").textContent()).toBe("0");
        await apply.click();
        expect(await page.getByLabel("Applied filter").textContent()).toBe(`"name" = 'ANG'`);
        expect(await page.getByLabel("Raw SQL").textContent()).toBe("false");
        await input.fill("id = 1 OR id = 2 AND id = 3");
        await page.getByRole("button", { name: "Ausdruck übernehmen" }).click();
        expect(
          await page.getByRole("alert").filter({ hasText: "Gemischte AND/OR" }).textContent(),
        ).toContain("Gemischte AND/OR");
        expect(await page.getByPlaceholder("Wert", { exact: true }).inputValue()).toBe("ANG");
        expect(await apply.isDisabled()).toBe(true);
        await input.fill(`name IN ('O''Brien', 'a,b') AND id >= 2`);
        await input.press("Enter");
        await page.getByRole("button", { name: "Wert entfernen: O'Brien", exact: true }).waitFor();
        await apply.click();
        expect(await page.getByLabel("Applied filter").textContent()).toBe(
          `"name" IN ('O''Brien', 'a,b') AND "id" >= 2`,
        );
        await page.getByRole("tab", { name: "SQL", exact: true }).click();
        const editor = page.locator(".monaco-editor .view-lines");
        await editor.click();
        await page.keyboard.press("ControlOrMeta+a");
        await page.keyboard.insertText(`name = '''Berlin'''`);
        await page.getByRole("tab", { name: "Einfach", exact: true }).click();
        expect(await page.getByPlaceholder("Wert", { exact: true }).inputValue()).toBe("Berlin");
        await apply.click();
        expect(await page.getByLabel("Applied filter").textContent()).toBe(`"name" = 'Berlin'`);
        await page.getByRole("tab", { name: "SQL", exact: true }).click();
        await editor.click();
        await page.keyboard.press("ControlOrMeta+a");
        await page.keyboard.insertText("id = 1 OR (id = 2 AND name IS NULL)");
        await page.getByRole("tab", { name: "Einfach", exact: true }).click();
        expect(
          await page.getByRole("alert").filter({ hasText: "Gemischte AND/OR" }).textContent(),
        ).toContain("Gemischte AND/OR");
        expect(
          await page.getByRole("tab", { name: "SQL", exact: true }).getAttribute("aria-selected"),
        ).toBe("true");
        expect(await page.getByLabel("Applied filter").textContent()).toBe(`"name" = 'Berlin'`);
        await editor.click();
        await page.keyboard.press("ControlOrMeta+a");
        await page.keyboard.press("Backspace");
        await page.keyboard.type(`"name" = ‚ABG'`);
        await apply.click();
        expect(await page.getByLabel("Applied filter").textContent()).toBe(`"name" = 'ABG'`);
        await page.getByRole("button", { name: "Aktiven Filter bearbeiten" }).dblclick();
        const badge = page.getByRole("textbox", { name: "Aktiven Filter bearbeiten" });
        await badge.fill(`"name" = ‚ANG'`);
        await badge.press("Enter");
        expect(await page.getByLabel("Applied filter").textContent()).toBe(`"name" = 'ANG'`);
        expect(errors).toEqual([]);
      } finally {
        await browser.close();
      }
    },
    60_000,
  );
}
