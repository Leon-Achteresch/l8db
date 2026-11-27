import { expect, test } from "bun:test";
import { chromium, webkit } from "playwright";
import { seedApp } from "./fixtures/perf-app";
import { interactionPercentiles, measureAppClick } from "./fixtures/perf-app-interactions";
import {
  appRequestSnapshot,
  installAppRequestProbe,
  requestsSince,
} from "./fixtures/perf-app-requests";

const appUrl = process.env.L8DB_CLOUD_PROJECTS_BROWSER_URL;
const total = 257;

for (const engine of [chromium, webkit]) {
  test.skipIf(!appUrl)(
    `${engine.name()}: self-hosted projects open the matching saved SQL profile`,
    async () => {
      const browser = await engine.launch();
      try {
        const page = await browser.newPage();
        await seedApp(page, 1);
        await page.addInitScript(() => {
          const tauri = (
            window as unknown as {
              __TAURI_INTERNALS__: { invoke(command: string, args?: unknown): Promise<unknown> };
            }
          ).__TAURI_INTERNALS__;
          const invoke = tauri.invoke;
          tauri.invoke = (command, args) => {
            if (command === "supabase_is_connected") return Promise.resolve(true);
            if (command === "supabase_projects")
              return Promise.resolve({
                projects: ["perf", "anderes Projekt"].map((name, i) => ({
                  reference: `self-hosted-${i}`,
                  name,
                  api_url: "http://localhost:8000",
                  self_hosted: true,
                })),
              });
            return invoke(command, args);
          };
        });
        await installAppRequestProbe(page);
        await page.goto(`${appUrl}/connections`);
        const saved = page
          .locator("article")
          .filter({ has: page.getByTitle("perf", { exact: true }) });
        const other = page.locator("article").filter({ has: page.getByTitle("anderes Projekt") });
        await saved.getByRole("button", { name: "SQL öffnen" }).waitFor();
        await other.getByRole("button", { name: "Verbinden" }).waitFor();
        const before = await appRequestSnapshot(page);
        await saved.getByRole("button", { name: "perf Aktionen" }).click();
        await page.getByRole("menuitem", { name: "Datenbankverbindung bearbeiten" }).click();
        await page.getByRole("heading", { name: "Verbindung bearbeiten" }).waitFor();
        await page.getByRole("heading", { name: "perf", exact: true }).waitFor();
        await page.getByRole("button", { name: "Editor schließen" }).click();
        await page.getByRole("textbox", { name: "Verbindungen suchen" }).fill("perf");
        await saved.getByRole("button", { name: "SQL öffnen" }).waitFor();
        expect(await other.isVisible()).toBe(false);
        expect(requestsSince(before, await appRequestSnapshot(page)).databaseRequests).toBe(0);
      } finally {
        await browser.close();
      }
    },
    60000,
  );

  test.skipIf(!appUrl)(
    `${engine.name()}: cloud-only project search, paging and profile import`,
    async () => {
      const browser = await engine.launch();
      try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
        await seedApp(page, 1);
        await page.addInitScript((count) => {
          const tauri = (
            window as unknown as {
              __TAURI_INTERNALS__: { invoke(command: string, args?: unknown): Promise<unknown> };
            }
          ).__TAURI_INTERNALS__;
          const invoke = tauri.invoke;
          const profiles = Array.from({ length: count }, (_, i) => ({
            id: `p${i}`,
            name: `Projekt ${String(i).padStart(4, "0")}`,
            project_id: `p${i}`,
            endpoint: i < 25 ? "https://nord.example" : "https://sued.example",
          }));
          tauri.invoke = (command, args) => {
            if (command === "appwrite_profiles") return Promise.resolve(profiles);
            if (command === "connection_in_other_window") return Promise.resolve(false);
            return invoke(command, args);
          };
        }, total);
        await installAppRequestProbe(page);
        await page.goto(`${appUrl}/connections`);
        const cards = page.locator("article h3");
        const next = page.getByRole("button", { name: "Nächste Projektseite" });
        const previous = page.getByRole("button", { name: "Vorherige Projektseite" });
        await next.waitFor();
        await page.getByRole("button", { name: "perf als Favorit markieren" }).click();
        await page.getByRole("button", { name: "Nur Favoriten" }).click();
        await next.waitFor({ state: "hidden" });
        await page.getByRole("button", { name: "perf Aktionen" }).click();
        await page.getByRole("menuitem", { name: "Löschen", exact: true }).click();
        await page.getByRole("alertdialog").getByRole("button", { name: "Entfernen" }).click();
        await next.waitFor();
        expect(await page.getByRole("button", { name: "Nur Favoriten" }).count()).toBe(0);
        const search = page.getByRole("textbox", { name: "Verbindungen suchen" });
        expect(await search.getAttribute("placeholder")).toContain("Anbieter");
        const before = await appRequestSnapshot(page);
        await next.focus();
        await page.keyboard.press("Enter");
        await page.getByText("25–48 von 257 Projekten", { exact: true }).waitFor();
        await previous.click();
        const samples: number[] = [];
        const seen = new Set<string>();
        for (let step = 0; step <= 20; step++) {
          const index = step <= 10 ? step : 20 - step;
          if (step) {
            const first = `Projekt ${String(index * 24).padStart(4, "0")}`;
            samples.push(
              await measureAppClick(
                page,
                step <= 10 ? next : previous,
                `article h3[title="${first}"]`,
              ),
            );
          }
          const names = await cards.allTextContents();
          expect(names.length).toBe(Math.min(24, total - index * 24));
          for (const name of names) seen.add(name);
          if (index === 10) expect(await next.isDisabled()).toBe(true);
        }
        expect(seen.size).toBe(total);
        expect(await previous.isDisabled()).toBe(true);
        const timing = interactionPercentiles(samples);
        console.log(engine.name(), "257 cloud projects", {
          median: timing.medianMs,
          p95: timing.p95Ms,
        });
        expect(timing.medianMs).toBeLessThan(150);
        expect(timing.p95Ms).toBeLessThan(350);

        await search.fill("nord.example");
        await next.click();
        await page.getByText("25–25 von 25 Projekten", { exact: true }).waitFor();
        expect(await cards.allTextContents()).toEqual(["Projekt 0024"]);
        await search.fill("Projekt 0256");
        await page.getByRole("heading", { name: "Projekt 0256" }).waitFor();
        expect(await next.isVisible()).toBe(false);
        await search.fill("fehlt");
        await page.getByRole("button", { name: "Suche zurücksetzen" }).click();
        await page.getByText("1–24 von 257 Projekten", { exact: true }).waitFor();
        await page.setViewportSize({ width: 390, height: 844 });
        const importButton = page.getByRole("button", {
          name: "Verbindungen importieren",
          exact: true,
        });
        await importButton.focus();
        await page.keyboard.press("Enter");
        const dialog = page.getByRole("dialog", { name: "Verbindungen importieren" });
        await dialog.waitFor();
        await page.keyboard.press("Escape");
        await dialog.waitFor({ state: "hidden" });
        const after = await appRequestSnapshot(page);
        expect(requestsSince(before, after).databaseRequests).toBe(0);
        expect(
          after.calls
            .slice(before.calls.length)
            .filter((cmd) => cmd.endsWith("_profiles") || cmd === "supabase_projects"),
        ).toEqual([]);
      } finally {
        await browser.close();
      }
    },
    90000,
  );
}
