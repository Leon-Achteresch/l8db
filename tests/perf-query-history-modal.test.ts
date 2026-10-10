import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { chromium, webkit } from "playwright";
import { reportScenario } from "../scripts/performance-report";
import { seedApp } from "./fixtures/perf-app";
import { interactionPercentiles, measureAppClick } from "./fixtures/perf-app-interactions";
import {
  appRequestSnapshot,
  installAppRequestProbe,
  requestsSince,
  waitForAppMetadata,
} from "./fixtures/perf-app-requests";
import { installQueryTransferFixture } from "./fixtures/perf-query-transfer";

test.skipIf(!process.env.L8DB_PERF_APP)(
  "query history keeps nested transfer, focus, toast actions and 5000-query export bounded",
  async () => {
    const dist = process.env.L8DB_PERF_DIST ?? "dist";
    const server = Bun.serve({
      port: 0,
      fetch: async (request) => {
        const pathname = new URL(request.url).pathname;
        const file = Bun.file(resolve(dist, pathname.replace(/^\//, "")));
        return new Response(
          pathname !== "/" && (await file.exists()) ? file : Bun.file(resolve(dist, "index.html")),
        );
      },
    });
    const throttled = process.env.L8DB_PERF_ENGINE !== "webkit";
    const browser = await (throttled ? chromium : webkit).launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await seedApp(page, 3000);
      await installQueryTransferFixture(page);
      await installAppRequestProbe(page);
      await page.goto(`http://localhost:${server.port}/query`);
      await page.locator('.monaco-editor[role="code"]').waitFor();
      await waitForAppMetadata(page, [
        "list_tables",
        "list_all_columns",
        "list_functions",
        "list_procedures",
      ]);
      const baseline = await page.evaluate(() => ({
        nodes: document.querySelectorAll("*").length,
        pointerEvents: document.body.style.pointerEvents,
        inert: document.getElementById("root")?.hasAttribute("inert"),
        outsideToasters: document.querySelectorAll("[data-sonner-toaster]").length,
      }));
      const cdp = throttled ? await page.context().newCDPSession(page) : null;
      await cdp?.send("Emulation.setCPUThrottlingRate", { rate: 4 });
      await cdp?.send("HeapProfiler.collectGarbage");
      const heapBefore = (await cdp?.send("Runtime.getHeapUsage"))?.usedSize ?? null;
      const before = await appRequestSnapshot(page);
      const tools = page.getByRole("button", { name: "Weitere Werkzeuge" });
      const dialog = page.locator('[data-slot="query-history-dialog"]');
      await tools.click();
      const outerColdMs = await measureAppClick(
        page,
        page.getByRole("menuitem", { name: /Verlauf & Gespeichertes/ }),
        '[data-slot="query-history-dialog"] [data-slot="query-history-list"] [data-index="0"]',
      );
      await dialog.waitFor();
      expect(await dialog.getAttribute("aria-modal")).toBe("true");
      expect(
        await dialog
          .getByRole("textbox", { name: "Query-Verlauf durchsuchen" })
          .evaluate((element) => element === document.activeElement),
      ).toBe(true);
      expect(
        await page
          .locator('#root button[aria-label="Suchen"]')
          .evaluate((element) => element.closest('[aria-hidden="true"]') !== null),
      ).toBe(true);
      expect(await page.evaluate(() => document.body.style.pointerEvents)).toBe(
        baseline.pointerEvents,
      );
      await page.locator('#root button[aria-label="Suchen"]').evaluate((element) => {
        (element as HTMLElement).focus();
      });
      expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(
        true,
      );
      for (let index = 0; index < 25; index++) {
        await page.keyboard.press("Tab");
        expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(
          true,
        );
      }
      const blockedBackgroundEvents = await page.evaluate(() => {
        const background = document.querySelector<HTMLElement>('#root button[aria-label="Suchen"]');
        if (!background) throw new Error("background button missing");
        const types = [
          "pointerdown",
          "pointermove",
          "mousemove",
          "mouseover",
          "wheel",
          "touchstart",
          "dragstart",
        ];
        let actions = 0;
        const count = () => actions++;
        for (const type of types) background.addEventListener(type, count);
        const consumed = types.map(
          (type) => !background.dispatchEvent(new Event(type, { bubbles: true, cancelable: true })),
        );
        for (const type of types) background.removeEventListener(type, count);
        return { actions, consumed };
      });
      expect(blockedBackgroundEvents.actions).toBe(0);
      expect(blockedBackgroundEvents.consumed).toEqual(Array(7).fill(true));
      const commandShortcut = await page.evaluate(() =>
        /mac/i.test(`${navigator.platform} ${navigator.userAgent}`) ? "Meta+k" : "Control+k",
      );
      await page.keyboard.press(commandShortcut);
      const palette = dialog.locator('[aria-label="Command palette"] [role="combobox"]');
      await palette.waitFor();
      expect(await palette.evaluate((element) => element === document.activeElement)).toBe(true);
      await page.keyboard.press("Escape");
      await palette.waitFor({ state: "detached" });
      expect(await dialog.getAttribute("aria-modal")).toBe("true");
      const historyRow = dialog.locator('[data-slot="query-history-list"] [data-index="0"]');
      await historyRow.getByTitle("In neuem SQL-Tab öffnen").focus();
      await historyRow.getByRole("button", { name: "Löschen", exact: true }).click();
      const localToast = dialog.locator("[data-sonner-toast]");
      await localToast.getByText("Verlaufseintrag entfernt", { exact: true }).waitFor();
      const toastVisibility = await page.evaluate(() => ({
        local: [
          ...document.querySelectorAll<HTMLElement>(
            '[data-slot="query-history-dialog"] [data-sonner-toaster]',
          ),
        ].filter((element) => getComputedStyle(element).visibility !== "hidden").length,
        outside: [...document.querySelectorAll<HTMLElement>("[data-sonner-toaster]")].filter(
          (element) =>
            !element.closest('[data-slot="query-history-dialog"]') &&
            getComputedStyle(element).visibility !== "hidden",
        ).length,
      }));
      expect(toastVisibility.local).toBe(1);
      expect(toastVisibility.outside).toBe(0);
      await localToast.getByRole("button", { name: "Rückgängig", exact: true }).click();
      await dialog.getByText("SELECT 0 FROM table_0000", { exact: true }).waitFor();
      await dialog
        .getByRole("radiogroup", { name: "Query-Bibliothek" })
        .getByText("Gespeichert", { exact: true })
        .click();
      const exportButton = dialog.getByRole("button", { name: "Exportieren", exact: true });
      const exportSelector = '[data-slot="saved-query-export-list"] [data-index="0"]';
      const exportColdMs = await measureAppClick(page, exportButton, exportSelector);
      const exportDialog = dialog.getByRole("dialog", { name: "Gespeicherte Queries exportieren" });
      await exportDialog.waitFor();
      const firstExportRows = await exportDialog.locator("[data-index]").count();
      expect(firstExportRows).toBeLessThan(40);
      expect(await exportDialog.getAttribute("aria-modal")).toBe("true");
      expect(await page.evaluate(() => document.body.style.pointerEvents)).toBe(
        baseline.pointerEvents,
      );
      await dialog
        .locator('input[aria-label="Query-Verlauf durchsuchen"]')
        .evaluate((element) => (element as HTMLElement).focus());
      expect(
        await exportDialog.evaluate((element) => element.contains(document.activeElement)),
      ).toBe(true);
      for (let index = 0; index < 10; index++) {
        await page.keyboard.press("Tab");
        expect(
          await exportDialog.evaluate((element) => element.contains(document.activeElement)),
        ).toBe(true);
      }
      expect(
        await exportDialog.getByRole("button", { name: "5000 Queries exportieren" }).isEnabled(),
      ).toBe(true);
      expect(
        await exportDialog.evaluate(
          (element) => element.closest('[data-slot="query-history-dialog"]') !== null,
        ),
      ).toBe(true);
      const exportList = exportDialog.locator('[data-slot="saved-query-export-list"]');
      await exportList.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      await exportDialog.getByText("Gespeichert 4999", { exact: true }).waitFor();
      await exportDialog.getByRole("checkbox", { name: "Gespeichert 4999 auswählen" }).click();
      expect(
        await exportDialog.getByRole("button", { name: "4999 Queries exportieren" }).isEnabled(),
      ).toBe(true);
      await exportDialog.getByRole("checkbox", { name: "Gespeichert 4999 auswählen" }).click();
      await exportDialog.getByText("Gespeichert 4999", { exact: true }).click();
      await exportDialog.getByText("SELECT 4999", { exact: true }).waitFor();
      await page.keyboard.press("Escape");
      await exportDialog.waitFor({ state: "detached" });
      expect(await dialog.getAttribute("aria-modal")).toBe("true");
      await page.waitForFunction(() =>
        document.activeElement?.textContent?.includes("Exportieren"),
      );
      const exportSamples: number[] = [];
      for (let turn = 0; turn < 11; turn++) {
        const duration = await measureAppClick(page, exportButton, exportSelector);
        if (turn > 1) exportSamples.push(duration);
        expect(await exportDialog.locator("[data-index]").count()).toBeLessThan(40);
        await page.keyboard.press("Escape");
        await exportDialog.waitFor({ state: "detached" });
      }
      const exportOpens = interactionPercentiles(exportSamples);
      await measureAppClick(page, exportButton, exportSelector);
      await exportDialog.getByRole("button", { name: "5000 Queries exportieren" }).click();
      await exportDialog.waitFor({ state: "detached" });
      const exports = await page.evaluate(() => {
        const state = window as unknown as { __queryTransferExports: string[] };
        return state.__queryTransferExports.map((source) => {
          const file = JSON.parse(source) as { queries: { sql: string }[] };
          return {
            count: file.queries.length,
            first: file.queries[0].sql,
            last: file.queries.at(-1)?.sql,
            bytes: new TextEncoder().encode(source).byteLength,
          };
        });
      });
      expect(exports).toHaveLength(1);
      expect(exports[0].count).toBe(5000);
      expect(exports[0].first).toBe("SELECT 0");
      expect(exports[0].last).toBe("SELECT 4999");
      const importButton = dialog.getByRole("button", { name: "Importieren", exact: true });
      const importColdMs = await measureAppClick(
        page,
        importButton,
        '[data-slot="dialog-content"] button',
      );
      const importDialog = dialog.getByRole("dialog", { name: "Gespeicherte Queries importieren" });
      await importDialog.waitFor();
      expect(await importDialog.getAttribute("aria-modal")).toBe("true");
      expect(await page.evaluate(() => document.body.style.pointerEvents)).toBe(
        baseline.pointerEvents,
      );
      await page.keyboard.press("Escape");
      await importDialog.waitFor({ state: "detached" });
      const importSamples: number[] = [];
      for (let turn = 0; turn < 11; turn++) {
        const duration = await measureAppClick(
          page,
          importButton,
          '[data-slot="dialog-content"] button',
        );
        if (turn > 1) importSamples.push(duration);
        await page.keyboard.press("Escape");
        await importDialog.waitFor({ state: "detached" });
      }
      const importOpens = interactionPercentiles(importSamples);
      await importButton.click();
      await importDialog.waitFor();
      expect(
        await importDialog.evaluate(
          (element) => element.closest('[data-slot="query-history-dialog"]') !== null,
        ),
      ).toBe(true);
      await importDialog.getByRole("button", { name: "Datei wählen" }).click();
      await importDialog.getByText("Import-Probe", { exact: true }).waitFor();
      await importDialog.getByRole("button", { name: "1 Query importieren", exact: true }).click();
      await importDialog.waitFor({ state: "detached" });
      await dialog.getByRole("textbox", { name: "Query-Verlauf durchsuchen" }).fill("Import-Probe");
      await dialog.getByText("Import-Probe", { exact: true }).waitFor();
      await dialog
        .locator("[data-sonner-toast]")
        .getByText("1 Query importiert", { exact: true })
        .waitFor();
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "detached" });
      await page
        .locator("#root [data-sonner-toast]")
        .getByText("1 Query importiert", { exact: true })
        .waitFor();
      expect(await tools.evaluate((element) => element === document.activeElement)).toBe(true);
      const afterClose = await page.evaluate(() => ({
        hosts: document.querySelectorAll('[data-slot="query-history-host"]').length,
        children: document.querySelector('[data-slot="query-history-host"]')?.childElementCount,
        dialogs: document.querySelectorAll('[data-slot="query-history-dialog"]').length,
        pointerEvents: document.body.style.pointerEvents,
        inert: document.getElementById("root")?.hasAttribute("inert"),
        outsideVisibility: [...document.querySelectorAll<HTMLElement>("[data-sonner-toaster]")].map(
          (element) => getComputedStyle(element).visibility,
        ),
      }));
      expect(afterClose.hosts).toBe(1);
      expect(afterClose.children).toBe(0);
      expect(afterClose.dialogs).toBe(0);
      expect(afterClose.pointerEvents).toBe(baseline.pointerEvents);
      expect(afterClose.inert).toBe(baseline.inert);
      expect(afterClose.outsideVisibility).not.toContain("hidden");
      expect(
        await page
          .locator('#root button[aria-label="Suchen"]')
          .evaluate((element) => element.closest('[aria-hidden="true"]') !== null),
      ).toBe(false);
      await tools.click();
      await page.getByRole("menuitem", { name: /Verlauf & Gespeichertes/ }).click();
      await dialog.waitFor();
      const backgroundButton = page.locator('#root button[aria-label="Suchen"]');
      const bounds = await backgroundButton.boundingBox();
      if (!bounds) throw new Error("background button missing");
      await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      await dialog.waitFor({ state: "detached" });
      expect(await page.locator('[aria-label="Command palette"] [role="combobox"]').count()).toBe(
        0,
      );
      await tools.click();
      await page.getByRole("menuitem", { name: /Verlauf & Gespeichertes/ }).click();
      await dialog.waitFor();
      await page.evaluate(() => {
        const state = window as unknown as {
          __historyBackgroundReleases: string[];
          __releaseProbe: EventListener;
        };
        state.__historyBackgroundReleases = [];
        state.__releaseProbe = (event) => state.__historyBackgroundReleases.push(event.type);
        const button = document.querySelector('#root button[aria-label="Suchen"]');
        for (const type of ["pointerup", "mouseup", "auxclick", "contextmenu"])
          button?.addEventListener(type, state.__releaseProbe);
      });
      await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, {
        button: "right",
      });
      await dialog.waitFor({ state: "detached" });
      expect(await page.locator('[aria-label="Command palette"] [role="combobox"]').count()).toBe(
        0,
      );
      expect(
        await page.evaluate(() => {
          const state = window as unknown as {
            __historyBackgroundReleases: string[];
            __releaseProbe: EventListener;
          };
          const button = document.querySelector('#root button[aria-label="Suchen"]');
          for (const type of ["pointerup", "mouseup", "auxclick", "contextmenu"])
            button?.removeEventListener(type, state.__releaseProbe);
          return state.__historyBackgroundReleases;
        }),
      ).toEqual([]);
      await page.evaluate(() => {
        const root = document.getElementById("root");
        if (!root) throw new Error("app root missing");
        root.style.setProperty("pointer-events", "auto", "important");
      });
      for (let turn = 0; turn < 4; turn++) {
        await tools.click();
        await page.getByRole("menuitem", { name: /Verlauf & Gespeichertes/ }).click();
        await dialog.waitFor();
        await page.keyboard.press("Escape");
        await dialog.waitFor({ state: "detached" });
        expect(
          await page.evaluate(() => ({
            value: document.getElementById("root")?.style.getPropertyValue("pointer-events"),
            priority: document.getElementById("root")?.style.getPropertyPriority("pointer-events"),
            hosts: document.querySelectorAll('[data-slot="query-history-host"]').length,
            children: document.querySelector('[data-slot="query-history-host"]')?.childElementCount,
          })),
        ).toEqual({ value: "auto", priority: "important", hosts: 1, children: 0 });
      }
      await page.evaluate(() =>
        document.getElementById("root")?.style.removeProperty("pointer-events"),
      );
      const beforeIdle = await appRequestSnapshot(page);
      await page.waitForTimeout(300);
      const afterIdle = await appRequestSnapshot(page);
      const operations = requestsSince(before, beforeIdle);
      const idle = requestsSince(beforeIdle, afterIdle);
      await cdp?.send("HeapProfiler.collectGarbage");
      const heapAfter = (await cdp?.send("Runtime.getHeapUsage"))?.usedSize ?? null;
      const retainedHeapBytes =
        heapBefore !== null && heapAfter !== null ? heapAfter - heapBefore : null;
      await reportScenario(`query-history-modal-${throttled ? "chromium" : "webkit"}`, {
        browser: browser.version(),
        cpuRate: throttled ? 4 : 1,
        historyEntries: 5000,
        savedEntries: 5000,
        baseline,
        outerColdMs,
        exportColdMs,
        exportOpens,
        importColdMs,
        importOpens,
        firstExportRows,
        exports,
        toastVisibility,
        blockedBackgroundEvents,
        afterClose,
        retainedHeapBytes,
        idleDurationMs: 300,
        operations,
        idle,
        activeDatabaseRequests: afterIdle.activeDatabaseRequests,
      });
      expect(operations.databaseRequests).toBe(0);
      expect(operations.unknownRequests).toBe(0);
      expect(idle.databaseRequests).toBe(0);
      expect(idle.unknownRequests).toBe(0);
      expect(afterIdle.activeDatabaseRequests).toBe(0);
      if (retainedHeapBytes !== null) expect(retainedHeapBytes).toBeLessThan(16 * 1024 * 1024);
      expect(outerColdMs).toBeLessThanOrEqual(120);
      expect(exportColdMs).toBeLessThanOrEqual(120);
      expect(exportOpens.p95Ms).toBeLessThanOrEqual(120);
      expect(importColdMs).toBeLessThanOrEqual(120);
      expect(importOpens.p95Ms).toBeLessThanOrEqual(120);
      expect(
        errors.filter(
          (error) => error !== "ResizeObserver loop completed with undelivered notifications.",
        ),
      ).toEqual([]);
    } finally {
      await browser.close();
      server.stop(true);
    }
  },
  60000,
);
