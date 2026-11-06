import { expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { chromium, webkit } from "playwright";
import { createServer } from "vite";
import manifest from "../package.json";
import { reportScenario } from "../scripts/performance-report";
import { featureStorageKey, NEXT_FEATURE_VERSION } from "../src/lib/new-features";
import { FALLBACK_PROVIDERS } from "../src/lib/providers";

test.skipIf(!process.env.L8DB_WORKBENCH_BROWSER)(
  "table helper menus: NEW, timestamp settings, watched changes and bounded idle UI for 200 watches over 5,000 rows",
  async () => {
    const server = await createServer({
      configFile: false,
      cacheDir: "node_modules/.vite-table-helper-menus",
      optimizeDeps: { entries: ["tests/fixtures/workbench-qol.html"] },
      plugins: [react(), tailwindcss()],
      resolve: { alias: { "@": resolve("src") } },
      server: { port: 0, hmr: false },
    });
    await server.listen();
    const browser = await (process.env.L8DB_WORKBENCH_BROWSER === "webkit"
      ? webkit
      : chromium
    ).launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors: string[] = [];
    const calls: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.exposeFunction("workbenchInvoke", (command: string) => {
      calls.push(command);
      return command === "list_providers" ? FALLBACK_PROVIDERS : [];
    });
    await page.addInitScript(() => {
      Object.assign(window, {
        __TAURI_INTERNALS__: {
          invoke: (command: string) =>
            (
              window as unknown as { workbenchInvoke: (command: string) => Promise<unknown> }
            ).workbenchInvoke(command),
          transformCallback: () => 1,
          unregisterCallback: () => {},
          metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
        },
      });
    });
    await page.route(/\/package\.json(\?|$)/, async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        body: (await response.text()).replaceAll(
          `"${manifest.version}"`,
          `"${NEXT_FEATURE_VERSION}"`,
        ),
      });
    });
    const address = server.httpServer?.address();
    if (!address || typeof address === "string") throw new Error("Fixture server fehlt.");
    const folder = "test-artifacts/table-helper-menus";
    await mkdir(folder, { recursive: true });
    try {
      await page.goto(`http://localhost:${address.port}/tests/fixtures/workbench-qol.html?table=1`);
      await page.locator('tr[data-ctid="0"]').waitFor();
      const more = page.getByRole("button", { name: "Weitere Aktionen", exact: true });
      await expect(more.getByRole("img", { name: "Neu" }).count()).resolves.toBe(1);
      const initialGridTop = await page
        .locator("table")
        .evaluate((el) => el.getBoundingClientRect().top);
      expect(await page.getByRole("button", { name: /Zeit:|Beobachtete Datensätze/ }).count()).toBe(
        0,
      );
      expect(await more.count()).toBe(1);
      await more.click();
      const actions = page.getByRole("menu");
      await actions.getByRole("menuitem", { name: "Neue Zeile", exact: true }).waitFor();
      expect(await actions.getByRole("menuitem", { name: "Neue Zeile", exact: true }).count()).toBe(
        1,
      );
      expect(
        await actions
          .getByRole("menuitem", { name: "Beobachtete Zeilen (0)", exact: true })
          .count(),
      ).toBe(1);
      expect(
        await actions
          .getByRole("menuitem", { name: "Zeitdarstellung: Original", exact: true })
          .count(),
      ).toBe(1);
      await page
        .getByRole("menuitem", { name: "Zeitdarstellung: Original", exact: true })
        .waitFor();
      expect(
        await page.evaluate(
          (key) => localStorage.getItem(key),
          featureStorageKey("query.results.timestamps"),
        ),
      ).toBeNull();
      await actions.getByRole("menuitem", { name: "Neue Zeile", exact: true }).hover();
      await page.getByText("Neue Zeile", { exact: true }).waitFor();
      await page.screenshot({ path: `${folder}/menu-new.png` });
      await page.getByRole("menuitem", { name: "Zeitdarstellung: Original", exact: true }).click();
      await page.getByRole("menuitemradio", { name: "UTC", exact: true }).waitFor();
      await page.screenshot({ path: `${folder}/time-dark.png` });
      await page.getByRole("menuitemradio", { name: "UTC", exact: true }).click();
      await page.waitForFunction(
        () =>
          JSON.parse(localStorage.getItem("l8db.query-qol") ?? "{}").state?.timestamps.mode ===
          "utc",
      );
      await more.click();
      await page.getByRole("menuitem", { name: "Zeitdarstellung: UTC", exact: true }).click();
      await page.getByRole("menuitemradio", { name: "Millisekunden", exact: true }).click();
      await more.click();
      await page.getByRole("menuitem", { name: "Neue Zeile", exact: true }).click();
      await page.getByText("Neue Zeile · Entwurf", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Verwerfen", exact: true }).click();
      await page.locator('tr[data-ctid="0"]').click({ button: "right" });
      await page.getByRole("menuitem", { name: "Datensatz beobachten", exact: true }).click();
      await page.getByRole("button", { name: "Neu laden", exact: true }).click();
      const baselineCalls = calls.length;
      await more.click();
      await page.getByRole("menuitem", { name: /Beobachtete Zeilen \(1\).*1 geändert/ }).click();
      const panel = page.getByRole("dialog", { name: "Beobachtete Zeilen", exact: true });
      await panel.getByText('"geändert"', { exact: true }).waitFor();
      await panel.getByText('"Original"', { exact: true }).waitFor();
      expect(await page.locator("table").evaluate((el) => el.getBoundingClientRect().top)).toBe(
        initialGridTop,
      );
      await page.waitForTimeout(800);
      for (const width of [1440, 760, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await page.screenshot({ path: `${folder}/watches-dark-${width}.png` });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
      }
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.getByRole("button", { name: "Design wechseln", exact: true }).click();
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${folder}/watches-light.png` });
      await page.getByRole("button", { name: "Stand übernehmen", exact: true }).click();
      await panel.getByText("Geladene Werte unverändert", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Beobachtung id=0 entfernen", exact: true }).click();
      await panel.getByText("Wichtige Zeilen im Blick behalten", { exact: true }).waitFor();
      await page.keyboard.press("Escape");
      await panel.waitFor({ state: "hidden" });
      await page.evaluate(async () =>
        (
          window as unknown as {
            workbenchFixture: { seedWatches: (count: number) => Promise<void> };
          }
        ).workbenchFixture.seedWatches(200),
      );
      const latencies: number[] = [];
      let panelNodes = 0;
      for (let i = 0; i < 5; i++) {
        await more.click();
        const started = performance.now();
        await page.getByRole("menuitem", { name: /Beobachtete Zeilen \(200\)/ }).click();
        await panel.getByText("200", { exact: true }).waitFor();
        latencies.push(performance.now() - started);
        panelNodes = Math.max(panelNodes, await panel.locator("*").count());
        expect(
          await panel.locator('[data-slot="accordion-content"][data-state="open"]').count(),
        ).toBeLessThanOrEqual(1);
        await page.keyboard.press("Escape");
        await panel.waitFor({ state: "hidden" });
      }
      latencies.sort((a, b) => a - b);
      expect(latencies.at(-1)).toBeLessThan(1000);
      expect(panelNodes).toBeLessThan(4000);
      expect(await page.locator("tbody tr").count()).toBeLessThan(90);
      await page.waitForTimeout(400);
      expect(await page.locator('[data-slot="sheet-content"]').count()).toBe(0);
      expect(calls.slice(baselineCalls)).toEqual([]);
      expect(errors).toEqual([]);
      await reportScenario("table-helper-menus", {
        rows: 5000,
        watches: 200,
        openLatency: { medianMs: latencies[2], p95Ms: latencies.at(-1) },
        maxPanelNodes: panelNodes,
        maxPanelNodeBudget: 4000,
        mountedRows: await page.locator("tbody tr").count(),
        additionalDatabaseRequests: calls.length - baselineCalls,
        closedPanelNodes: 0,
        browser: browser.browserType().name(),
      });
    } finally {
      await page.screenshot({ path: `${folder}/last-state.png` }).catch(() => {});
      await browser.close();
      await server.close();
    }
  },
  120_000,
);
