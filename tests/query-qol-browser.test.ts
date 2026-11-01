import { expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { chromium, webkit } from "playwright";
import { createServer } from "vite";
import { reportScenario } from "../scripts/performance-report";

test.skipIf(!process.env.L8DB_PERF_BROWSER)(
  "QoL controls retain results, format time, size columns and persist masked snapshots without extra DB reads",
  async () => {
    const server = await createServer({
      configFile: false,
      cacheDir: "node_modules/.vite-query-qol",
      optimizeDeps: { entries: ["tests/fixtures/query-qol.html"] },
      plugins: [react(), tailwindcss()],
      resolve: { alias: { "@": resolve("src") } },
      server: { port: 0, hmr: false },
    });
    await server.listen();
    const browser = await (process.env.L8DB_PERF_ENGINE === "webkit" ? webkit : chromium).launch({
      headless: true,
    });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const calls: string[] = [];
    await page.exposeFunction("qolInvoke", (command: string, args: { sql?: string }) => {
      calls.push(command);
      if (command === "execute_query") {
        if (args.sql?.includes("broken")) throw new Error("ERROR: column broken does not exist");
        return {
          columns: ["id", "created_at", "description"],
          rows: Array.from({ length: 999 }, (_, id) => ({
            id,
            created_at: "2026-10-25 02:30:45.123+02",
            description: `Ein längerer Wert der Zeile ${id}`,
          })),
          rows_affected: 999,
          execution_time_ms: 1,
          truncated: false,
        };
      }
      return null;
    });
    await page.addInitScript(() => {
      const callbacks = new Map();
      Object.assign(window, {
        __TAURI_INTERNALS__: {
          invoke: (command: string, args: unknown) =>
            (
              window as unknown as {
                qolInvoke: (command: string, args: unknown) => Promise<unknown>;
              }
            ).qolInvoke(command, args),
          transformCallback: (fn: unknown) => {
            callbacks.set(callbacks.size, fn);
            return callbacks.size - 1;
          },
          unregisterCallback: () => {},
          metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
        },
      });
    });
    try {
      await page.goto(
        `http://localhost:${(server.httpServer!.address() as { port: number }).port}/tests/fixtures/query-qol.html`,
        { waitUntil: "commit" },
      );
      await page.getByRole("button", { name: "Erfolgreich ausführen" }).click();
      await page
        .getByTitle("Vollständigen Zellwert anzeigen", { exact: true })
        .first()
        .waitFor({ timeout: 5000 });
      const nodeCount = await page.locator("tbody tr").count();
      expect(nodeCount).toBeLessThan(70);
      const baselineRequests = calls.filter((command) => command === "execute_query").length;
      await page.getByRole("button", { name: /Zeit: Original/ }).click();
      await page.getByRole("menuitemradio", { name: "UTC", exact: true }).click();
      await page.getByText("2026-10-25 00:30:45 UTC", { exact: true }).first().waitFor();
      await page.getByRole("button", { name: "Inhaltsbreite", exact: true }).click();
      await page.getByRole("button", { name: /Ergebnisstände/ }).click();
      await page.getByRole("textbox", { name: "Name des Ergebnisstands" }).fill("vor Migration");
      await page.getByRole("button", { name: "Speichern", exact: true }).click();
      await page.getByText("vor Migration", { exact: true }).waitFor();
      await page.keyboard.press("Escape");
      let failedLatencies: number[] = [];
      for (let i = 0; i < 5; i++) {
        await page.getByRole("button", { name: "Fehler auslösen" }).click();
        await page.getByText(/Vorheriger erfolgreicher Lauf vom/).waitFor();
        await page.waitForFunction(
          (count) =>
            JSON.parse(
              document.querySelector('[aria-label="Fehlerlaufzeiten"]')?.textContent ?? "[]",
            ).length === count,
          i + 1,
        );
        failedLatencies = JSON.parse(
          (await page.getByLabel("Fehlerlaufzeiten").textContent()) ?? "[]",
        );
        expect(await page.locator("tbody tr").count()).toBeLessThan(70);
      }
      failedLatencies.sort((a, b) => a - b);
      expect(failedLatencies.at(-1)).toBeLessThan(1000);
      expect(
        await page.getByTitle("Vollständigen Zellwert anzeigen", { exact: true }).count(),
      ).toBeGreaterThan(0);
      expect(calls.filter((command) => command === "execute_query").length).toBe(
        baselineRequests + 5,
      );
      await mkdir("test-artifacts/query-qol", { recursive: true });
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.screenshot({
          path: `test-artifacts/query-qol/previous-${width}.png`,
          fullPage: true,
        });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
      }
      await page.getByRole("button", { name: "Erfolgreich ausführen" }).click();
      await page.getByRole("button", { name: /Ergebnisstände/ }).click();
      await page.getByRole("button", { name: "Vergleichen", exact: true }).click();
      await page.getByRole("button", { name: "Ergebnisstand-Vergleich schließen" }).waitFor();
      await page.screenshot({ path: "test-artifacts/query-qol/compare-390.png", fullPage: true });
      await page.getByRole("button", { name: "Ergebnisstand-Vergleich schließen" }).click();
      await page.reload({ waitUntil: "commit" });
      await page.getByRole("button", { name: /Ergebnisstände/ }).click();
      await page.getByText("vor Migration", { exact: true }).waitFor();
      await page.screenshot({ path: "test-artifacts/query-qol/snapshots-390.png", fullPage: true });
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.screenshot({
        path: "test-artifacts/query-qol/snapshots-1440.png",
        fullPage: true,
      });
      await page.getByRole("button", { name: "vor Migration löschen" }).click();
      await page.getByText("Noch keine Ergebnisstände gespeichert.").waitFor();
      expect(errors).toEqual([]);
      await reportScenario("query-qol-browser", {
        rows: 999,
        failureRetention: { medianMs: failedLatencies[2], p95Ms: failedLatencies.at(-1) },
        mountedRows: nodeCount,
        databaseRequests: calls.filter((command) => command === "execute_query").length,
        errors,
      });
    } catch (failure) {
      console.log({ errors, calls, body: (await page.locator("body").innerText()).slice(0, 3000) });
      await mkdir("test-artifacts/query-qol", { recursive: true });
      await page.screenshot({ path: "test-artifacts/query-qol/failure.png", fullPage: true });
      throw failure;
    } finally {
      await browser.close();
      await server.close();
    }
  },
  120_000,
);
