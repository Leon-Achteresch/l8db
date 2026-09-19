import { expect, test } from "bun:test";
import { chromium } from "playwright";
import { installDebuggerMock } from "./fixtures/debugger";
import { seedApp } from "./fixtures/perf-app";

test.skipIf(!process.env.L8DB_DEBUG_BROWSER)(
  "debugger launches, steps, filters variables and stops through the routine UI",
  async () => {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await seedApp(page, 1);
      await page.addInitScript(installDebuggerMock);
      await page.goto("http://localhost:1420/functions/public/debug_sample?oid=%2210000%22");
      await page.getByRole("button", { name: "Debuggen", exact: true }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("button", { name: "Starten", exact: true }).click();
      await page.waitForFunction(
        () =>
          document.querySelector('[role="dialog"] [role="status"]')?.textContent === "Angehalten",
      );
      await dialog.getByRole("button", { name: "Darüber", exact: true }).click();
      await page.waitForFunction(() =>
        document.querySelector('[role="dialog"]')?.textContent?.includes("Zeile 5"),
      );
      await dialog.getByRole("textbox", { name: "Variablen filtern" }).fill("value");
      expect(await dialog.getByText("5", { exact: true }).count()).toBeGreaterThan(0);
      await dialog.getByRole("button", { name: "Stoppen", exact: true }).click();
      await page.waitForFunction(
        () =>
          document.querySelector('[role="dialog"] [role="status"]')?.textContent === "Abgebrochen",
      );
      await dialog.getByRole("button", { name: "Schließen", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
    }
  },
  45000,
);

test.skipIf(!process.env.L8DB_DEBUG_BROWSER)(
  "missing debugger extension disables execution with a useful reason",
  async () => {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await seedApp(page, 1);
      await page.addInitScript(installDebuggerMock);
      await page.goto("http://localhost:1420/functions/public/debug_sample?oid=%2210000%22");
      await page.evaluate(() => {
        Object.assign(window, { debugAvailable: false });
      });
      await page.getByRole("button", { name: "Debuggen", exact: true }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByText("Die Server-Erweiterung pldbgapi fehlt.", { exact: true }).waitFor();
      expect(await dialog.getByRole("button", { name: "Starten", exact: true }).isDisabled()).toBe(
        true,
      );
    } finally {
      await browser.close();
    }
  },
  45000,
);
