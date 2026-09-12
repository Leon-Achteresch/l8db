import { expect, test } from "bun:test";
import { chromium, webkit } from "playwright";

const url = process.env.L8DB_FILTER_BROWSER_URL;

for (const engine of [chromium, webkit]) {
  test.skipIf(!url)(
    `${engine.name()}: filter lists support Enter, plus, removal and operator changes`,
    async () => {
      const browser = await engine.launch({ headless: true });
      try {
        const page = await browser.newPage({ viewport: { width: 1100, height: 820 } });
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.addInitScript(() => {
          Object.assign(window, { __TAURI_INTERNALS__: { invoke: async () => [] } });
        });
        await page.goto(`${url}/tests/fixtures/filter-list.html`);
        await page.getByRole("button", { name: "Filter", exact: true }).click();
        await page.getByRole("combobox").nth(0).click();
        await page.getByRole("option", { name: "name", exact: true }).click();
        const operator = page.getByRole("combobox").nth(1);
        await operator.click();
        await page.getByRole("option", { name: "ist in Liste", exact: true }).click();
        const input = page.getByRole("textbox", { name: "Listenwert" });
        const add = page.getByRole("button", { name: "Wert hinzufügen", exact: true });
        const apply = page.getByRole("button", { name: "Filter anwenden", exact: true });
        expect(await apply.isDisabled()).toBe(true);
        expect(await add.isDisabled()).toBe(true);
        await input.fill("  ");
        await input.press("Enter");
        expect(await page.getByRole("button", { name: /^Wert entfernen:/ }).count()).toBe(0);
        await input.fill("Berlin");
        await input.press("Enter");
        expect(await input.inputValue()).toBe("");
        expect(await input.evaluate((el) => el === document.activeElement)).toBe(true);
        expect(await page.getByLabel("Apply count").textContent()).toBe("0");
        await input.fill("O'Brien, Jr.");
        await add.click();
        expect(await input.inputValue()).toBe("");
        expect(await input.evaluate((el) => el === document.activeElement)).toBe(true);
        await input.fill("Berlin");
        await input.press("Enter");
        await page.getByRole("button", { name: "Wert entfernen: Berlin", exact: true }).waitFor();
        expect(await page.getByRole("button", { name: /^Wert entfernen:/ }).count()).toBe(2);
        await apply.click();
        expect(await page.getByLabel("Applied filter").textContent()).toBe(
          `"name" IN ('Berlin', 'O''Brien, Jr.')`,
        );
        expect(await page.getByLabel("Raw SQL").textContent()).toBe("false");
        await operator.click();
        await page.getByRole("option", { name: "ist nicht in Liste", exact: true }).click();
        await page.getByRole("button", { name: "Wert entfernen: Berlin", exact: true }).waitFor();
        expect(await page.getByRole("button", { name: /^Wert entfernen:/ }).count()).toBe(2);
        await page.getByRole("button", { name: "Wert entfernen: Berlin", exact: true }).click();
        await apply.click();
        expect(await page.getByLabel("Applied filter").textContent()).toBe(
          `"name" NOT IN ('O''Brien, Jr.')`,
        );
        await operator.click();
        await page.getByRole("option", { name: "ist gleich", exact: true }).click();
        expect(await page.getByPlaceholder("Wert", { exact: true }).inputValue()).toBe(
          "O'Brien, Jr.",
        );
        await operator.click();
        await page.getByRole("option", { name: "ist in Liste", exact: true }).click();
        await page.setViewportSize({ width: 390, height: 844 });
        await input.fill(
          "Ein sehr langer Listenwert mit Leerzeichen und Sonderzeichen, der umbrechen muss",
        );
        await input.press("Enter");
        const box = await add.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.x + box!.width).toBeLessThanOrEqual(390);
        await page.screenshot({ path: `/tmp/l8db-filter-list-${engine.name()}.png` });
        await page.getByRole("button", { name: "Zurücksetzen", exact: true }).click();
        await input.waitFor({ state: "hidden" });
        expect(await page.getByRole("button", { name: /^Wert entfernen:/ }).count()).toBe(0);
        expect(await page.getByLabel("Applied filter").textContent()).toBe("");
        await page.setViewportSize({ width: 1100, height: 820 });
        await page.locator('th[data-column-id="name"]').click({ button: "right" });
        await page.getByRole("menuitem", { name: "Filter setzen…" }).click();
        const popover = page.locator('[data-slot="popover-content"]');
        await popover.getByRole("combobox").click();
        await page.getByRole("option", { name: "ist nicht in Liste", exact: true }).click();
        const headerInput = popover.getByRole("textbox", { name: "Listenwert" });
        await headerInput.fill("Hamburg");
        await headerInput.press("Enter");
        await popover.getByRole("button", { name: "Filter anwenden" }).click();
        expect(await page.getByLabel("Applied filter").textContent()).toBe(
          `"name" NOT IN ('Hamburg')`,
        );
        expect(errors).toEqual([]);
      } finally {
        await browser.close();
      }
    },
    60_000,
  );
}

for (const engine of [chromium, webkit]) {
  test.skipIf(!url)(
    `${engine.name()}: settings persist and native databases show appropriate filters`,
    async () => {
      const browser = await engine.launch({ headless: true });
      try {
        const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.addInitScript(() => {
          Object.assign(window, { __TAURI_INTERNALS__: { invoke: async () => [] } });
        });
        await page.goto(`${url}/tests/fixtures/filter-list.html`);
        await page.getByText("Einstellungen", { exact: true }).click();
        const setting = page.getByRole("switch", { name: "Filteroperatoren übersetzen" });
        expect(await setting.getAttribute("aria-checked")).toBe("true");
        await setting.click();
        await page.reload();
        await page.getByText("Einstellungen", { exact: true }).click();
        expect(await setting.getAttribute("aria-checked")).toBe("false");
        await page.getByText("Einstellungen", { exact: true }).click();
        await page.getByRole("button", { name: "Filter", exact: true }).click();
        await page.getByRole("combobox", { name: "Filteroperator" }).click();
        await page.getByRole("option", { name: "=", exact: true }).waitFor();
        const labels = await page.getByRole("option").allTextContents();
        expect(new Set(labels).size).toBe(labels.length);
        expect(labels).toContain("ILIKE '%…%'");
        expect(labels).toContain("ILIKE '…%'");
        expect(labels).toContain("ILIKE '%…'");
        expect(labels).toContain("IS NULL");
        await page.keyboard.press("Escape");

        await page.goto(`${url}/tests/fixtures/filter-list.html?kind=cassandra`);
        await page.getByRole("button", { name: "Filter", exact: true }).click();
        await page.getByRole("combobox", { name: "Filteroperator" }).click();
        await page.getByRole("option", { name: "IN", exact: true }).waitFor();
        expect(await page.getByRole("option").allTextContents()).toEqual([
          "=",
          "IN",
          ">",
          ">=",
          "<",
          "<=",
        ]);
        await page.keyboard.press("Escape");
        await page.getByRole("button", { name: "Bedingung hinzufügen" }).click();
        await page.getByRole("combobox").nth(2).click();
        await page.getByRole("option", { name: "und", exact: true }).waitFor();
        expect(await page.getByRole("option", { name: "oder", exact: true }).count()).toBe(0);

        await page.goto(`${url}/tests/fixtures/filter-list.html?kind=mongodb`);
        await page.getByRole("button", { name: "Filter", exact: true }).click();
        expect(await page.getByRole("tab", { name: "JSON", exact: true }).isVisible()).toBe(true);
        await page.getByRole("combobox").nth(0).click();
        await page.getByRole("option", { name: "name", exact: true }).click();
        await page.getByRole("combobox", { name: "Filteroperator" }).click();
        await page.getByRole("option", { name: "$nin", exact: true }).click();
        const input = page.getByRole("textbox", { name: "Listenwert" });
        await input.fill("Berlin");
        await input.press("Enter");
        await page.getByRole("button", { name: "Filter anwenden" }).click();
        expect(JSON.parse((await page.getByLabel("Applied filter").textContent())!)).toEqual({
          name: { $nin: ["Berlin"] },
        });
        await page.getByRole("tab", { name: "JSON", exact: true }).click();
        expect(
          JSON.parse(await page.getByRole("textbox", { name: "MongoDB-Filter" }).inputValue()),
        ).toEqual({ name: { $nin: ["Berlin"] } });

        await page.goto(`${url}/tests/fixtures/filter-list.html?kind=redis`);
        await page.locator('th[data-column-id="key"]').click({ button: "right" });
        await page.getByRole("menuitem", { name: "Filter setzen…" }).click();
        const popover = page.locator('[data-slot="popover-content"]');
        await popover.getByRole("combobox").click();
        await page.getByRole("option", { name: "MATCH *…*", exact: true }).waitFor();
        expect(await page.getByRole("option").count()).toBe(4);
        expect(await page.getByRole("option", { name: "IN", exact: true }).count()).toBe(0);
        await page.getByRole("option", { name: "MATCH *…*", exact: true }).click();
        await popover.getByPlaceholder("Wert", { exact: true }).fill("user:*");
        await popover.getByRole("button", { name: "Filter anwenden" }).click();
        expect(await page.getByLabel("Applied filter").textContent()).toBe("*user:\\**");
        expect(errors).toEqual([]);
      } finally {
        await browser.close();
      }
    },
    60_000,
  );
}

for (const engine of [chromium, webkit]) {
  test.skipIf(!url)(
    `${engine.name()}: query results use the same list input and filter locally`,
    async () => {
      const browser = await engine.launch({ headless: true });
      try {
        const page = await browser.newPage({ viewport: { width: 1100, height: 820 } });
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.addInitScript(() => {
          Object.assign(window, { __TAURI_INTERNALS__: { invoke: async () => [] } });
        });
        await page.goto(`${url}/tests/fixtures/filter-list.html?result`);
        await page.getByRole("button", { name: "Filter", exact: true }).click();
        await page.getByRole("button", { name: "enthält", exact: true }).click();
        await page.getByRole("menuitemcheckbox", { name: "ist in Liste", exact: true }).click();
        const input = page.getByRole("textbox", { name: "Filter für name" });
        await input.fill("Berlin");
        await input.press("Enter");
        await page.getByText("1 von 4 Zeilen", { exact: true }).waitFor();
        await input.fill("Hamburg");
        await page.getByRole("button", { name: "Wert hinzufügen" }).click();
        await page.getByText("2 von 4 Zeilen", { exact: true }).waitFor();
        await page.getByRole("button", { name: "Wert entfernen: Berlin", exact: true }).click();
        await page.getByText("1 von 4 Zeilen", { exact: true }).waitFor();
        await page.getByRole("button", { name: "ist in Liste", exact: true }).click();
        await page
          .getByRole("menuitemcheckbox", { name: "ist nicht in Liste", exact: true })
          .click();
        await page.getByText("2 von 4 Zeilen", { exact: true }).waitFor();
        expect(await page.locator("tbody").textContent()).toContain("Berlin");
        expect(await page.locator("tbody").textContent()).toContain("a,b");
        expect(await page.locator("tbody").textContent()).not.toContain("Hamburg");
        expect(errors).toEqual([]);
      } finally {
        await browser.close();
      }
    },
    60_000,
  );
}
