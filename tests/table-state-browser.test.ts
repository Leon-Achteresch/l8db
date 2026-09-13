import { expect, test } from "bun:test";
import { chromium, webkit } from "playwright";

const url = process.env.L8DB_TABLE_BROWSER_URL;

for (const engine of [chromium, webkit]) {
  test.skipIf(!url)(
    `${engine.name()}: table tabs restore filters, drafts, page, detail and scrolling`,
    async () => {
      const browser = await engine.launch({ headless: true });
      try {
        const page = await browser.newPage({ viewport: { width: 1100, height: 820 } });
        const errors: string[] = [];
        page.on("pageerror", (error) => {
          const existingWebKitLayoutNotification =
            engine === webkit &&
            error.message === "ResizeObserver loop completed with undelivered notifications.";
          if (!existingWebKitLayoutNotification) errors.push(error.message);
        });
        await page.addInitScript(() => {
          Object.assign(window, {
            __TAURI_INTERNALS__: {
              invoke: async (command: string) => {
                if (command === "count_table_rows") return 500;
                if (command === "fetch_table_rows") {
                  await new Promise((resolve) => setTimeout(resolve, 80));
                  const columns = [
                    "id",
                    "name",
                    ...Array.from({ length: 25 }, (_, i) => `column_${i}`),
                  ];
                  return {
                    columns,
                    rows: Array.from({ length: 100 }, (_, i) =>
                      Object.fromEntries(
                        columns.map((column) => [column, column === "id" ? i : `Row ${i}`]),
                      ),
                    ),
                  };
                }
                return [];
              },
            },
          });
        });
        await page.goto(`${url}/tests/fixtures/table-state.html`);
        await page.locator("tbody tr[data-index]").first().waitFor();
        await page.getByRole("button", { name: "Filter", exact: true }).click();
        await page.waitForTimeout(350);
        await page.getByRole("combobox").first().click();
        await page.getByRole("option", { name: "name", exact: true }).click();
        await page.getByPlaceholder("Wert", { exact: true }).fill("Berlin");
        await page.getByRole("button", { name: "Filter anwenden", exact: true }).click();
        await page.getByPlaceholder("Wert", { exact: true }).fill("Hamburg");
        await page.waitForTimeout(300);
        const nameHeader = page.locator('th[data-column-id="name"]');
        await nameHeader.click({ button: "right" });
        await page.getByRole("menuitem", { name: "Absteigend sortieren", exact: true }).click();
        await page.getByText("(absteigend)", { exact: false }).waitFor();
        const resize = nameHeader.locator("div.cursor-col-resize");
        const box = await resize.boundingBox();
        if (!box) throw new Error("Missing resize handle");
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2, { steps: 5 });
        await page.mouse.up();
        const savedWidth = await nameHeader.evaluate((element) => element.style.width);
        const scroller = page.locator('div[style*="contain: strict"]');
        await scroller.evaluate((element) => {
          element.scrollLeft = 850;
        });
        await page.waitForTimeout(100);
        const nextPage = page
          .locator("button")
          .filter({ has: page.locator("svg.lucide-chevron-right") });
        await nextPage.click();
        await page.getByText("Seite 2 / 5", { exact: true }).waitFor();
        await page.waitForTimeout(200);
        expect(await scroller.evaluate((element) => element.scrollLeft)).toBe(850);
        await scroller.evaluate((element) => {
          element.scrollTop = 1100;
          element.scrollLeft = 850;
        });
        await page.waitForTimeout(350);
        const position = await scroller.evaluate((element) => ({
          top: element.scrollTop,
          left: element.scrollLeft,
        }));
        expect(position.top).toBeGreaterThan(900);
        expect(position.left).toBeGreaterThan(700);
        await page.getByRole("link", { name: "Orders", exact: true }).click();
        await page.getByText("Keine Filter aktiv", { exact: true }).waitFor();
        await page.getByRole("link", { name: "Customers", exact: true }).click();
        await page.getByText("Seite 2 / 5", { exact: true }).waitFor();
        expect(await page.getByPlaceholder("Wert", { exact: true }).inputValue()).toBe("Hamburg");
        await page.getByText("\"name\" = 'Berlin'", { exact: true }).waitFor();
        await page.waitForTimeout(400);
        expect(
          await scroller.evaluate((element) => ({
            top: element.scrollTop,
            left: element.scrollLeft,
          })),
        ).toEqual(position);
        await scroller.evaluate((element) => {
          element.scrollLeft = 0;
        });
        expect(await nameHeader.evaluate((element) => element.style.width)).toBe(savedWidth);
        await page.getByText("(absteigend)", { exact: false }).waitFor();
        await scroller.evaluate((element) => {
          element.scrollLeft = 850;
        });
        await page.waitForTimeout(100);
        await page.getByRole("tab", { name: "Columns", exact: true }).click();
        await page.getByRole("link", { name: "Orders", exact: true }).click();
        await page.getByRole("link", { name: "Customers", exact: true }).click();
        expect(
          await page
            .getByRole("tab", { name: "Columns", exact: true })
            .getAttribute("aria-selected"),
        ).toBe("true");
        await page.getByRole("tab", { name: "Daten", exact: true }).click();
        await page.getByRole("button", { name: "Database B", exact: true }).click();
        await page.getByText("Keine Filter aktiv", { exact: true }).waitFor();
        await page.getByRole("button", { name: "Database A", exact: true }).click();
        await page.getByText("Seite 2 / 5", { exact: true }).waitFor();
        expect(await page.getByPlaceholder("Wert", { exact: true }).inputValue()).toBe("Hamburg");
        await page.waitForTimeout(350);
        await page.reload();
        await page.getByText("Seite 2 / 5", { exact: true }).waitFor();
        expect(await page.getByPlaceholder("Wert", { exact: true }).inputValue()).toBe("Hamburg");
        await page.waitForTimeout(400);
        expect(
          await scroller.evaluate((element) => ({
            top: element.scrollTop,
            left: element.scrollLeft,
          })),
        ).toEqual(position);
        await page.getByRole("link", { name: "Related row", exact: true }).click();
        await page.getByText('"id" = 7', { exact: true }).waitFor();
        await page.getByText("Seite 1 / 5", { exact: true }).waitFor();
        await page.getByRole("link", { name: "Orders", exact: true }).click();
        await page.getByRole("link", { name: "Customers", exact: true }).click();
        await page.getByText('"id" = 7', { exact: true }).waitFor();
        await page.waitForTimeout(200);
        expect(await scroller.evaluate((element) => element.scrollLeft)).toBe(850);
        await page.screenshot({ path: `/tmp/l8db-table-state-${engine.name()}.png` });
        expect(errors).toEqual([]);
      } finally {
        await browser.close();
      }
    },
    60_000,
  );
}
