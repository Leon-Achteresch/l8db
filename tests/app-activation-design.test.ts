import { expect, test } from "bun:test";
import { chromium } from "playwright";

const url = process.env.L8DB_APP_DESIGN_BROWSER_URL;

test.skipIf(!url)(
  "first run offers immediate activation and preserves privacy and personalization",
  async () => {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`${url}/tests/fixtures/app-activation.html?mode=onboarding`);
      const start = page.getByRole("button", { name: "Direkt loslegen", exact: true });
      const customize = page.getByRole("button", { name: "Erst einrichten", exact: true });
      await start.waitFor();
      expect(await start.evaluate((node) => node === document.activeElement)).toBe(true);
      await start.press("Shift+Tab");
      expect(await customize.evaluate((node) => node === document.activeElement)).toBe(true);
      await customize.press("Tab");
      expect(await start.evaluate((node) => node === document.activeElement)).toBe(true);
      await customize.click();
      await page.getByRole("heading", { name: "Wie soll l8db aussehen?" }).waitFor();
      expect(await page.getByRole("button", { pressed: true }).count()).toBeGreaterThan(0);

      await page.goto(`${url}/tests/fixtures/app-activation.html?mode=onboarding`);
      await start.waitFor();
      const before = await page.evaluate(
        () => JSON.parse(localStorage.getItem("l8db.settings") ?? "{}").state,
      );
      await start.click();
      await page.getByRole("dialog", { name: "Willkommen bei l8db" }).waitFor({ state: "hidden" });
      const after = await page.evaluate(
        () => JSON.parse(localStorage.getItem("l8db.settings") ?? "{}").state,
      );
      expect(after.onboardingDone).toBe(true);
      expect(after.crashReports).toBe(before.crashReports);
      expect(after.usageMetrics).toBe(before.usageMetrics);
      expect(after.easyMode).toBe(before.easyMode);
      expect(await page.evaluate(() => document.body.hasAttribute("data-onboarding-active"))).toBe(
        false,
      );
      await page.getByRole("button", { name: /^Datenbank verbinden/ }).click();
      await page.getByRole("button", { name: "Weiter", exact: true }).waitFor();
      await page.getByRole("button", { name: "Editor schließen", exact: true }).click();
      await page.getByRole("heading", { name: "Was möchtest du öffnen?" }).waitFor();
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
  60000,
);

test.skipIf(!url)(
  "workspace hierarchy survives window sizes, themes, scaling and query navigation",
  async () => {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`${url}/tests/fixtures/app-activation.html?tables=3000`);
      await page.getByRole("button", { name: "Neue SQL-Abfrage", exact: true }).waitFor();
      const nav = page.getByRole("navigation", { name: "Bereiche", exact: true });
      expect(await nav.getByText("SQL-Arbeitsplatz", { exact: true }).isVisible()).toBe(true);
      expect(await nav.locator('[aria-current="page"]').count()).toBe(1);
      for (const theme of ["light", "dark"]) {
        await page.evaluate(
          (theme) => document.documentElement.classList.toggle("dark", theme === "dark"),
          theme,
        );
        for (const width of [1600, 1280, 900]) {
          await page.setViewportSize({ width, height: 900 });
          for (const scale of [100, 150]) {
            await page.evaluate((scale) => {
              document.documentElement.style.fontSize = `${scale}%`;
            }, scale);
            const layout = await page.evaluate(() => {
              const inset = document.querySelector('[data-slot="sidebar-inset"]');
              if (!inset) throw new Error("Missing workspace inset");
              return {
                width: document.documentElement.clientWidth,
                scrollWidth: document.documentElement.scrollWidth,
                nodes: document.querySelectorAll("*").length,
                insetShadow: getComputedStyle(inset).boxShadow,
              };
            });
            expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width);
            expect(layout.nodes).toBeLessThan(1600);
            expect(layout.insetShadow).toBe("none");
          }
        }
      }
      await page.evaluate(() => {
        document.documentElement.style.fontSize = "100%";
      });
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.getByRole("button", { name: "Neue SQL-Abfrage", exact: true }).click();
      await page.waitForURL(/\/query\//);
      await page.locator('[data-tour="query-toolbar"]').waitFor();
      expect(await nav.locator('[aria-current="page"]').getAttribute("aria-label")).toBe(
        "SQL-Arbeitsplatz",
      );
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
  60000,
);
