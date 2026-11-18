import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { type Browser, chromium, type Page } from "playwright";
import type { HealthCheckStatus, IndexObservation } from "../src/lib/db/health";
import { interactionPercentiles, measureAppClick } from "./fixtures/perf-app-interactions";

const url = process.env.L8DB_TABLE_BROWSER_URL;
const run = url ? test : test.skip;
const timestamp = "2026-11-18T01:12:34.000Z";
const checkTitle = "Indizes ohne gemeldete Scans";
const explanation =
  "Resets einzelner Objekte können den Zeitstempel ändern. Zusammen mit Last auf Replikas und nicht beobachteter Last begrenzt das die Aussage der Zähler. Der Zeitstempel garantiert keinen Beobachtungsbeginn für einen einzelnen Index.";

type Fixture = {
  observation?: IndexObservation;
  calls: string[];
  count: number;
};

let browser: Browser;
beforeAll(async () => {
  if (url) browser = await chromium.launch({ channel: process.env.L8DB_BROWSER_CHANNEL });
}, 30_000);
afterAll(async () => {
  await browser?.close();
}, 15_000);

async function fixture(count: number, width: number, colorScheme: "dark" | "light") {
  const context = await browser.newContext({
    colorScheme,
    viewport: { width, height: 800 },
    timezoneId: "America/New_York",
  });
  await context.addInitScript(
    ({ count, timestamp, checkTitle, explanation }) => {
      const host: Fixture = {
        observation: { databaseStatsResetAt: timestamp, tracksCounts: true },
        calls: [],
        count,
      };
      Object.assign(window, {
        observationFixture: host,
        __TAURI_INTERNALS__: {
          invoke: async (command: string) => {
            host.calls.push(command);
            if (command === "list_providers") return [];
            if (command !== "run_database_health_checks") throw new Error("unexpected IPC");
            const status: HealthCheckStatus = host.count ? "issue" : "ok";
            return {
              durationMs: 2,
              checks: [
                {
                  id: "unused_indexes",
                  category: "performance",
                  title: checkTitle,
                  explanation,
                  status,
                  severity: host.count ? "info" : null,
                  objects: Array.from({ length: host.count }, (_, i) => ({
                    name: `a25.items_${i}`,
                    detail: "auf a25.items, 3 MB, 0 gemeldete Scans",
                    fixSql: `DROP INDEX CONCURRENTLY a25.items_${i};`,
                  })),
                  fixSql: host.count ? "DROP INDEX CONCURRENTLY a25.items_0;" : null,
                  skippedReason: null,
                  indexObservation: host.observation,
                },
                {
                  id: "missing_primary_key",
                  category: "schema",
                  title: "Tabellen ohne Primärschlüssel",
                  explanation: "Keine Befunde.",
                  status: "ok",
                  severity: null,
                  objects: [],
                  fixSql: null,
                  skippedReason: null,
                },
              ],
            };
          },
        },
      });
    },
    { count, timestamp, checkTitle, explanation },
  );
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.setDefaultTimeout(7000);
  await page.goto(`${url}/tests/fixtures/index-observation-health.html`, { timeout: 35_000 });
  await check(page).waitFor();
  return { context, page, errors };
}

const check = (page: Page) => page.getByRole("button", { name: new RegExp(checkTitle) });
const observation = (page: Page) => page.getByLabel("Index-Beobachtungsbasis");
const calls = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { observationFixture: Fixture }).observationFixture.calls,
  );
const refresh = (page: Page) =>
  page.getByRole("button", { name: "Erneut prüfen", exact: true }).click();

run(
  "the existing index check distinguishes reported UTC, no reset, disabled, and older payloads",
  async () => {
    const { context, page, errors } = await fixture(1, 410, "dark");
    try {
      const toggle = check(page);
      expect(await observation(page).count()).toBe(0);
      await toggle.press("Enter");
      const time = observation(page).locator("time");
      expect(await time.getAttribute("datetime")).toBe(timestamp);
      expect(await time.innerText()).toContain("01:12:34 UTC");
      expect(await page.getByText(explanation, { exact: true }).count()).toBe(1);
      expect(await page.getByText(/0 gemeldete Scans/).count()).toBe(1);
      expect(await page.getByRole("button", { name: "Im Editor öffnen" }).count()).toBe(1);
      expect(await observation(page).evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(
        true,
      );
      await mkdir("test-artifacts/browser", { recursive: true });
      await page.screenshot({ path: "test-artifacts/browser/index-observation-health.png" });

      await page.evaluate(() => {
        const host = (window as unknown as { observationFixture: Fixture }).observationFixture;
        host.observation = { databaseStatsResetAt: null, tracksCounts: false };
      });
      await refresh(page);
      await observation(page).getByText("Unbekannt", { exact: true }).waitFor();
      expect(await time.count()).toBe(0);
      expect(
        await page.getByText("Statistikerfassung in dieser Sitzung deaktiviert.").count(),
      ).toBe(1);

      await page.evaluate(() => {
        const host = (window as unknown as { observationFixture: Fixture }).observationFixture;
        host.observation = undefined;
        host.count = 0;
      });
      await refresh(page);
      await observation(page).waitFor({ state: "hidden" });
      await toggle.press("Enter");
      await page.getByText("Statistikerfassung unbekannt.").waitFor();
      expect(await observation(page).getByText("Unbekannt", { exact: true }).count()).toBe(1);
      expect(await page.getByRole("button", { name: "Im Editor öffnen" }).count()).toBe(0);
      await toggle.press("Space");
      expect(await observation(page).count()).toBe(0);
      expect(await toggle.evaluate((node) => node === document.activeElement)).toBe(true);
      expect(await calls(page)).toEqual([
        "list_providers",
        ...Array(3).fill("run_database_health_checks"),
      ]);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  },
  65_000,
);

run(
  "the 200-result health check adds one observation section and no extra browser requests",
  async () => {
    const { context, page, errors } = await fixture(200, 1100, "light");
    try {
      const toggle = check(page);
      const durations: number[] = [];
      for (let index = 0; index < 10; index++) {
        const elapsed = await measureAppClick(
          page,
          toggle,
          '[aria-label="Index-Beobachtungsbasis"]',
        );
        if (index > 1) durations.push(elapsed);
        expect(await observation(page).count()).toBe(1);
        expect(await page.getByText(/0 gemeldete Scans/).count()).toBe(200);
        await toggle.click();
        await observation(page).waitFor({ state: "hidden" });
      }
      const latency = interactionPercentiles(durations);
      expect(latency.p95Ms).toBeLessThanOrEqual(120);
      expect(await page.getByText(/0 gemeldete Scans/).count()).toBe(0);
      await page.waitForTimeout(300);
      expect(await calls(page)).toEqual(["list_providers", "run_database_health_checks"]);
      console.log("A25 Indexprüfung", {
        ...latency,
        maxObjects: 200,
        observationSections: 1,
        additionalRequests: 0,
      });
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  },
  65_000,
);
