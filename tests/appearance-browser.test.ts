import { expect, test } from "bun:test";
import { chromium, type Page, webkit } from "playwright";
import { seedApp } from "./fixtures/perf-app";

const url = process.env.L8DB_APPEARANCE_BROWSER_URL;

async function setScale(page: Page, scale: number) {
  const slider = page.getByRole("slider", { name: "Oberflächengröße" });
  await slider.press("Home");
  for (let value = 80; value < scale; value += 5) await slider.press("ArrowRight");
}

for (const engine of [chromium, webkit]) {
  test.skipIf(!url)(
    `${engine.name()}: appearance controls, persistence, portals and virtual scrolling`,
    async () => {
      const browser = await engine.launch();
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      try {
        const page = await context.newPage();
        const errors: string[] = [];
        let stage = "load";
        page.on("pageerror", (error) => errors.push(`${stage}: ${error.message}`));
        await page.goto(`${url}/tests/fixtures/appearance.html`);
        await page.getByRole("slider").waitFor();
        for (const scale of [80, 100, 150]) {
          stage = `scale ${scale}`;
          await setScale(page, scale);
          let previousHeights = [0, 0, 0, 0];
          for (const density of ["Kompakt", "Standard", "Großzügig"]) {
            stage = `${scale}, ${density}`;
            await page.getByRole("radio", { name: density, exact: true }).locator("..").click();
            await page.waitForTimeout(150);
            const metrics = await page.evaluate(() => {
              const item = document.querySelector<HTMLElement>("[data-slot=sidebar-menu-button]")!;
              return {
                font: Number.parseFloat(getComputedStyle(item).fontSize),
                heights: [
                  item,
                  document.querySelector('[data-testid="data-table"] tr[data-index]')!,
                  document.querySelector('[data-testid="query-result"] tr[data-index]')!,
                  document.querySelector('[data-testid="sample-button"]')!,
                ].map((node) => node.getBoundingClientRect().height),
                width: document.documentElement.scrollWidth,
              };
            });
            expect(metrics.font).toBeCloseTo((14 * scale) / 100, 1);
            metrics.heights.forEach((height, index) =>
              expect(height).toBeGreaterThan(previousHeights[index]),
            );
            expect(metrics.width).toBeLessThanOrEqual(1280);
            previousHeights = metrics.heights;
            for (const fraction of [null, 0, 0.5, 1]) {
              if (fraction !== null) {
                await page.getByTestId("sidebar-scroll").evaluate((node, value) => {
                  node.scrollTop = (node.scrollHeight - node.clientHeight) * value;
                }, fraction);
                const gridScroll = page
                  .getByTestId("data-table")
                  .locator("div.overflow-auto")
                  .first();
                await page
                  .getByTestId("query-result")
                  .locator("div.overflow-auto")
                  .evaluate((node, value) => {
                    node.scrollTop = (node.scrollHeight - node.clientHeight) * value;
                  }, fraction);
                await gridScroll.evaluate((node, value) => {
                  node.scrollTop = (node.scrollHeight - node.clientHeight) * value;
                }, fraction);
              }
              await page.waitForTimeout(200);
              const coverage = await page.evaluate(() => {
                const sidebar = document.querySelector<HTMLElement>(
                  '[data-testid="sidebar-scroll"]',
                )!;
                const query = document.querySelector<HTMLElement>(
                  '[data-testid="query-result"] div.overflow-auto',
                )!;
                const table = document.querySelector<HTMLElement>(
                  '[data-testid="data-table"] div.overflow-auto',
                )!;
                return [
                  [sidebar, '[data-slot="sidebar-menu-item"]'],
                  [table, "tr[data-index]"],
                  [query, "tr[data-index]"],
                ].map(([container, selector]) => {
                  const scroller = container as HTMLElement;
                  const nodes = [...scroller.querySelectorAll(selector as string)];
                  const box = scroller.getBoundingClientRect();
                  return {
                    count: nodes.length,
                    last: nodes.at(-1)?.getAttribute("data-index"),
                    top: nodes[0]?.getBoundingClientRect().top,
                    bottom: nodes.at(-1)?.getBoundingClientRect().bottom,
                    viewportTop: box.top,
                    viewportBottom: box.bottom,
                  };
                });
              });
              for (const item of coverage) {
                expect(item.count).toBeGreaterThan(0);
                expect(item.count).toBeLessThan(100);
                expect(item.top!).toBeLessThanOrEqual(item.viewportTop + 100);
                expect(item.bottom!).toBeGreaterThanOrEqual(
                  item.viewportBottom - (item.last === "2999" ? 20 : 2),
                );
              }
            }
          }
          await page.getByRole("button", { name: "Dialog öffnen" }).click();
          await page.getByRole("dialog").waitFor();
          await page.getByRole("combobox").click();
          await page.getByRole("option", { name: "ARTIKEL", exact: true }).click();
          const dialog = await page.getByRole("dialog").boundingBox();
          expect(dialog!.x).toBeGreaterThanOrEqual(0);
          expect(dialog!.x + dialog!.width).toBeLessThanOrEqual(1280);
          expect(dialog!.y).toBeGreaterThanOrEqual(0);
          expect(dialog!.y + dialog!.height).toBeLessThanOrEqual(900);
          await page.keyboard.press("Escape");
        }
        await page.reload();
        await page.getByRole("slider").waitFor();
        expect(await page.getByRole("slider").inputValue()).toBe("150");
        expect(await page.getByRole("radio", { name: "Großzügig" }).isChecked()).toBe(true);
        expect(await page.getByRole("button", { name: "Oberfläche vergrößern" }).isDisabled()).toBe(
          true,
        );
        const other = await context.newPage();
        await other.goto(`${url}/tests/fixtures/appearance.html`);
        await other.getByRole("slider").waitFor();
        await page.getByRole("button", { name: "Zurücksetzen", exact: true }).click();
        await other.waitForFunction(() => document.documentElement.dataset.uiScale === "100");
        expect(await other.getByRole("radio", { name: "Standard", exact: true }).isChecked()).toBe(
          true,
        );
        await page.setViewportSize({ width: 760, height: 560 });
        await setScale(page, 150);
        await page.getByRole("radio", { name: "Großzügig" }).locator("..").click();
        await page
          .getByRole("button", { name: "Zurücksetzen", exact: true })
          .scrollIntoViewIfNeeded();
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
          760,
        );
        await page.waitForTimeout(600);
        await page.screenshot({
          path: `/tmp/l8db-appearance-${engine.name()}.png`,
          fullPage: true,
        });
        await page.getByRole("button", { name: "Zurücksetzen", exact: true }).click();
        expect(await page.getByRole("slider").inputValue()).toBe("100");
        await other.close();
        await page.evaluate(() =>
          localStorage.setItem(
            "l8db.settings",
            JSON.stringify({
              state: { uiScale: "broken", uiDensity: "dense", editorFontSize: 20, rowLimit: 500 },
              version: 0,
            }),
          ),
        );
        await page.reload();
        await page.getByRole("slider").waitFor();
        expect(await page.getByRole("slider").inputValue()).toBe("100");
        await setScale(page, 80);
        expect(
          await page.getByRole("button", { name: "Oberfläche verkleinern" }).isDisabled(),
        ).toBe(true);
        await page.getByRole("button", { name: "Zurücksetzen", exact: true }).click();
        const saved = await page.evaluate(
          () => JSON.parse(localStorage.getItem("l8db.settings")!).state,
        );
        expect(saved.editorFontSize).toBe(20);
        expect(saved.rowLimit).toBe(500);
        expect(errors).toEqual([]);
      } finally {
        await context.close();
        await browser.close();
      }
    },
    120_000,
  );
}

for (const engine of [chromium, webkit]) {
  for (const platform of ["MacIntel", "Win32"]) {
    test.skipIf(!url)(
      `${engine.name()} ${platform}: application settings stay reachable at maximum scale`,
      async () => {
        const browser = await engine.launch();
        try {
          const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
          await page.addInitScript(
            (value) => Object.defineProperty(navigator, "platform", { value }),
            platform,
          );
          await seedApp(page, 3000);
          await page.goto(`${url}/settings`);
          await page.getByRole("slider", { name: "Oberflächengröße" }).waitFor();
          await setScale(page, 150);
          await page.getByRole("radio", { name: "Großzügig" }).locator("..").click();
          await page.setViewportSize({ width: 760, height: 560 });
          const reset = page.getByRole("button", { name: "Zurücksetzen", exact: true }).first();
          await reset.scrollIntoViewIfNeeded();
          await page.waitForTimeout(600);
          const rect = await reset.boundingBox();
          expect(rect!.x).toBeGreaterThanOrEqual(0);
          expect(rect!.x + rect!.width).toBeLessThanOrEqual(760);
          expect(rect!.y + rect!.height).toBeLessThanOrEqual(560);
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth),
          ).toBeLessThanOrEqual(760);
          await page.screenshot({ path: `/tmp/l8db-appearance-app-${engine.name()}.png` });
          await page.getByRole("button", { name: "Bereiche öffnen" }).click();
          expect(await page.getByRole("menuitem").count()).toBe(11);
          await page.keyboard.press("Escape");
          await reset.click();
          expect(await page.getByRole("slider").inputValue()).toBe("100");
          await page.getByPlaceholder("Einstellungen durchsuchen …").fill("Oberflächengröße");
          expect(await page.getByText("Oberflächengröße", { exact: true }).count()).toBeGreaterThan(
            0,
          );
        } finally {
          await browser.close();
        }
      },
      60_000,
    );
  }
}

for (const engine of [chromium, webkit]) {
  test.skipIf(!url)(
    `${engine.name()}: extra compact sidebar keeps all rows reachable`,
    async () => {
      const browser = await engine.launch();
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      try {
        const page = await context.newPage();
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.goto(`${url}/tests/fixtures/appearance.html`);
        const toggle = page.getByRole("switch", { name: "Seitenleiste extra kompakt" });
        await toggle.waitFor();
        for (const scale of [80, 100, 150]) {
          await setScale(page, scale);
          for (const density of ["Kompakt", "Standard", "Großzügig"]) {
            await page.getByRole("radio", { name: density, exact: true }).locator("..").click();
            await toggle.uncheck();
            await page.waitForTimeout(300);
            const tableRow = page.locator('[data-testid="data-table"] tr[data-index]').first();
            const before = await tableRow.evaluate((node) => node.getBoundingClientRect().height);
            await toggle.check();
            await page.waitForTimeout(300);
            expect(await tableRow.evaluate((node) => node.getBoundingClientRect().height)).toBe(
              before,
            );
            const button = page.locator('[data-slot="sidebar-menu-button"]').first();
            expect(
              await button.evaluate((node) => node.getBoundingClientRect().height),
            ).toBeCloseTo((20 * scale) / 100, 1);
            expect(
              await button.evaluate((node) => Number.parseFloat(getComputedStyle(node).fontSize)),
            ).toBeCloseTo((14 * scale) / 100, 1);
            for (const fraction of [0, 0.5, 1]) {
              await page.getByTestId("sidebar-scroll").evaluate((node, value) => {
                node.scrollTop = (node.scrollHeight - node.clientHeight) * value;
              }, fraction);
              await page.waitForTimeout(300);
              const coverage = await page.getByTestId("sidebar-scroll").evaluate((node) => {
                const rows = [
                  ...node.querySelectorAll<HTMLElement>('[data-slot="sidebar-menu-item"]'),
                ];
                const bounds = node.getBoundingClientRect();
                return {
                  count: rows.length,
                  first: rows[0].getBoundingClientRect().top,
                  last: rows.at(-1)!.getBoundingClientRect().bottom,
                  top: bounds.top,
                  bottom: bounds.bottom,
                  index: rows.at(-1)!.textContent,
                };
              });
              expect(coverage.count).toBeLessThan(100);
              expect(coverage.first).toBeLessThanOrEqual(coverage.top + 1);
              expect(coverage.last).toBeGreaterThanOrEqual(coverage.bottom - 1);
              if (fraction === 1) expect(coverage.index).toBe("ARTIKEL_2999");
            }
          }
        }
        await page.reload();
        await toggle.waitFor();
        expect(await toggle.isChecked()).toBe(true);
        const other = await context.newPage();
        await other.goto(`${url}/tests/fixtures/appearance.html`);
        const otherToggle = other.getByRole("switch", { name: "Seitenleiste extra kompakt" });
        await otherToggle.waitFor();
        expect(await otherToggle.isChecked()).toBe(true);
        await page.getByRole("button", { name: "Zurücksetzen", exact: true }).click();
        await other.waitForFunction(
          () => document.documentElement.dataset.sidebarExtraCompact === "false",
        );
        expect(await toggle.isChecked()).toBe(false);
        await toggle.check();
        expect(
          await page.getByRole("button", { name: "Zurücksetzen", exact: true }).isEnabled(),
        ).toBe(true);
        expect(errors).toEqual([]);
      } finally {
        await context.close();
        await browser.close();
      }
    },
    60_000,
  );
}
