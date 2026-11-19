import { expect, test } from "bun:test";
import { chromium, type Locator, type Page, webkit } from "playwright";

const url = process.env.L8DB_TOOLTIP_BROWSER_URL;
const WARM_BUDGET_MS = 120;
const COLD_MIN_MS = 200;

function visibleTip(page: Page) {
  return page.evaluate(() => {
    const menuTip = document.querySelector<HTMLElement>("[data-icon-menu-tip]");
    if (menuTip && getComputedStyle(menuTip).opacity !== "0" && menuTip.style.opacity === "1")
      return menuTip.firstElementChild?.textContent ?? null;
    const open = [
      ...document.querySelectorAll<HTMLElement>(
        "[data-slot=tooltip-content]:not([data-icon-menu-tip])",
      ),
    ].filter((el) => el.dataset.state !== "closed");
    if (open.length > 1) return `__multiple:${open.length}`;
    return open[0]?.firstChild?.textContent ?? null;
  });
}

function renderedTips(page: Page) {
  return page.evaluate(
    () =>
      [
        ...document.querySelectorAll<HTMLElement>(
          "[data-slot=tooltip-content]:not([data-icon-menu-tip])",
        ),
      ].filter((el) => {
        const style = getComputedStyle(el);
        return style.display !== "none" && Number(style.opacity) > 0.05;
      }).length,
  );
}

async function moveTo(page: Page, target: Locator) {
  const box = await target.boundingBox();
  if (!box) throw new Error("Target geometry is unavailable");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 20 });
}

type TipProbe = { tipLatency: number | null };

async function timeUntilTip(page: Page, target: Locator, label: string) {
  await target.evaluate((el, expected) => {
    const probe = window as unknown as TipProbe;
    probe.tipLatency = null;
    let enteredAt = 0;
    el.addEventListener("pointerenter", () => (enteredAt = performance.now()), { once: true });
    const started = performance.now();
    const check = () => {
      const menuTip = document.querySelector<HTMLElement>("[data-icon-menu-tip]");
      const visible =
        (menuTip?.style.opacity === "1" && menuTip.firstElementChild?.textContent === expected) ||
        [...document.querySelectorAll<HTMLElement>("[data-slot=tooltip-content]")].some(
          (tip) => tip.dataset.state !== "closed" && tip.firstChild?.textContent === expected,
        );
      if (visible && enteredAt) probe.tipLatency = performance.now() - enteredAt;
      else if (performance.now() - started < 3000) requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  }, label);
  await moveTo(page, target);
  const shown = await page
    .waitForFunction(() => (window as unknown as TipProbe).tipLatency, undefined, {
      timeout: 3000,
    })
    .catch(async () => {
      throw new Error(`Tooltip "${label}" did not open, visible: ${await visibleTip(page)}`);
    });
  return Math.round(Number(await shown.jsonValue()));
}

function stats(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    median: sorted[Math.floor(sorted.length / 2)] ?? 0,
    p95: sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? 0,
  };
}

async function expectColdDelay(page: Page, target: Locator, label: string) {
  await page.mouse.move(5, 5, { steps: 20 });
  await page.waitForTimeout(1000);
  expect(await timeUntilTip(page, target, label)).toBeGreaterThan(COLD_MIN_MS);
}

for (const engine of [chromium, webkit]) {
  test.skipIf(!url)(
    `${engine.name()}: neighbouring tooltips open without a second delay`,
    async () => {
      const browser = await engine.launch({ headless: true });
      try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
        await page.goto(`${url}/tests/fixtures/tooltip-skip-delay.html`);
        await page.getByRole("menuitem", { name: "Menü 1" }).waitFor();
        await page.waitForTimeout(300);

        const warm: number[] = [];
        const buttons = [1, 2, 3, 4, 5].map((n) =>
          page.getByRole("button", { name: `Knopf ${n}` }),
        );
        const locked = page.getByRole("button", { name: "Los" });
        await expectColdDelay(page, buttons[0] as Locator, "Knopf 1");
        for (const round of [0, 1]) {
          const order = round ? buttons.slice(0, -1).reverse() : buttons.slice(1);
          for (const button of order) {
            const label = (await button.getAttribute("aria-label")) ?? "";
            warm.push(await timeUntilTip(page, button, label));
            expect(await visibleTip(page)).toBe(label);
            expect(await renderedTips(page)).toBe(1);
          }
        }
        warm.push(await timeUntilTip(page, locked.locator(".."), "Gesperrt"));
        await expectColdDelay(page, buttons[2] as Locator, "Knopf 3");

        const items = [1, 2, 3, 4, 5].map((n) => page.getByRole("menuitem", { name: `Menü ${n}` }));
        await expectColdDelay(page, items[0] as Locator, "Menü 1");
        for (const round of [0, 1]) {
          const order = round ? items.slice(0, -1).reverse() : items.slice(1);
          for (const item of order) {
            const label = (await item.getAttribute("aria-label")) ?? "";
            warm.push(await timeUntilTip(page, item, label));
          }
        }
        await expectColdDelay(page, items[3] as Locator, "Menü 4");

        const lockedItem = page.getByRole("menuitem", { name: "Menü gesperrt" });
        for (let round = 0; round < 6; round++) {
          for (const target of [items[4], lockedItem, items[3], lockedItem]) {
            const box = await (target as Locator).boundingBox();
            if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          }
        }
        await page.waitForTimeout(350);
        expect(await visibleTip(page)).toBe("Menü gesperrt");
        await moveTo(page, page.locator("[data-icon-menu] [role=separator]").last());
        await page.waitForTimeout(200);
        expect(await visibleTip(page)).toBeNull();
        await moveTo(page, items[4] as Locator);
        await page.mouse.move(5, 5, { steps: 5 });
        await page.waitForTimeout(200);
        expect(await visibleTip(page)).toBeNull();

        const menu = await page.locator("[data-icon-menu]").boundingBox();
        await moveTo(page, page.getByRole("menuitem", { name: "Anzeige" }));
        const option = page.getByRole("menuitem", { name: "Original" });
        await option.waitFor();
        await page.waitForTimeout(300);
        const sub = await option.boundingBox();
        expect(sub?.y).toBeGreaterThanOrEqual((menu?.y ?? 0) + (menu?.height ?? 0));
        expect(sub?.x).toBeLessThan((menu?.x ?? 0) + (menu?.width ?? 0));

        const { median, p95 } = stats(warm);
        console.info(
          `${engine.name()} tooltip warm switch: n=${warm.length} median ${median} ms, p95 ${p95} ms`,
        );
        expect(p95).toBeLessThan(WARM_BUDGET_MS);
      } finally {
        await browser.close();
      }
    },
    60_000,
  );
}
