import { expect, test } from "bun:test";
import { chromium, webkit } from "playwright";
import { saveBrowserArtifacts } from "./fixtures/browser-artifacts";

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
      await saveBrowserArtifacts(browser, "table-edit");
      await browser.close();
    }
  },
  60000,
);

for (const engine of [chromium, webkit]) {
  test.skipIf(
    !process.env.L8DB_TABLE_BROWSER_URL ||
      (engine === webkit && process.env.L8DB_BROWSER_ENGINES === "chromium"),
  )(
    `${engine.name()}: duplicated rows stay editable until saved and survive insert conflicts`,
    async () => {
      const browser = await engine.launch({ headless: true });
      const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.addInitScript(() => {
        window.__TAURI_INTERNALS__ = { invoke: async () => [] };
      });
      try {
        await page.goto(`${process.env.L8DB_TABLE_BROWSER_URL}/tests/fixtures/table-edit.html`);
        const source = page.locator('tr[data-index="1"] td[data-col="email"]');
        await source.click({ button: "right" });
        await page.getByRole("menuitem", { name: "Zeile duplizieren", exact: true }).click();
        const draft = page.locator("tr[data-draft-row]");
        await draft.waitFor();
        expect(await draft.locator("input").count()).toBe(3);
        expect(await draft.getByLabel("email bearbeiten", { exact: true }).inputValue()).toBe(
          "user2@example.test",
        );
        expect(await draft.getByLabel("id Wertmodus", { exact: true }).inputValue()).toBe(
          "default",
        );
        await draft.getByLabel("email bearbeiten", { exact: true }).fill("conflict@example.test");
        await draft.getByLabel("city bearbeiten", { exact: true }).fill("Leipzig");
        await page.keyboard.press("Enter");
        await page.keyboard.press("Tab");
        expect(await page.evaluate(() => window.testInserts)).toEqual([]);
        expect(await page.evaluate(() => window.testSaves)).toEqual([]);
        expect(await source.textContent()).toContain("user2@example.test");
        await page.screenshot({ path: "/tmp/l8db-duplicate-draft.png" });

        await source.click({ button: "right" });
        expect(
          await page
            .getByRole("menuitem", { name: "Zeile duplizieren", exact: true })
            .getAttribute("data-disabled"),
        ).not.toBeNull();
        await page.keyboard.press("Escape");
        await page.getByRole("button", { name: "Speichern", exact: true }).click();
        await page.getByRole("alert").waitFor();
        expect(await page.getByRole("alert").textContent()).toContain("Konflikt");
        expect(await draft.getByLabel("city bearbeiten", { exact: true }).inputValue()).toBe(
          "Leipzig",
        );
        await draft.getByLabel("email bearbeiten", { exact: true }).fill("copy@example.test");
        await page.getByRole("button", { name: "Speichern", exact: true }).click();
        await draft.waitFor({ state: "detached" });
        expect(await page.evaluate(() => window.testInserts)).toEqual([
          { email: "conflict@example.test", city: "Leipzig" },
          { email: "copy@example.test", city: "Leipzig" },
        ]);
        await page.getByText("copy@example.test", { exact: true }).waitFor();
        expect(await source.textContent()).toContain("user2@example.test");

        await source.click({ button: "right" });
        await page.getByRole("menuitem", { name: "Zeile duplizieren", exact: true }).click();
        await draft.waitFor();
        await draft.getByLabel("city Wertmodus", { exact: true }).selectOption("null");
        await page.getByRole("button", { name: "Verwerfen", exact: true }).click();
        await draft.waitFor({ state: "detached" });
        expect(await page.evaluate(() => window.testInserts.length)).toBe(2);
        expect(await page.evaluate(() => window.testSaves)).toEqual([]);
        await source.click({ button: "right" });
        await page.getByRole("menuitem", { name: "Zeile duplizieren", exact: true }).click();
        await draft.waitFor();
        await draft.getByLabel("email bearbeiten", { exact: true }).fill("");
        await draft.getByLabel("city Wertmodus", { exact: true }).selectOption("null");
        await page.getByRole("button", { name: "Speichern", exact: true }).click();
        await draft.waitFor({ state: "detached" });
        expect(await page.evaluate(() => window.testInserts.at(-1))).toEqual({
          email: "",
          city: null,
        });
        expect(errors).toEqual([]);
      } finally {
        await saveBrowserArtifacts(browser, "table-edit");
        await browser.close();
      }
    },
    60_000,
  );
}
