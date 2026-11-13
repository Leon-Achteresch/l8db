import { afterAll, beforeAll, expect, test } from "bun:test";
import { type Browser, chromium, type Page } from "playwright";
import { reportScenario } from "../scripts/performance-report";
import { CONVEX_STUDIO_QUERY, seedConvexStudio } from "./fixtures/convex-studio-mock";

const enabled = Boolean(process.env.L8DB_CONVEX_STUDIO_BROWSER);
const appUrl = process.env.L8DB_CONVEX_STUDIO_URL ?? "http://localhost:1420";
const OPEN_BUDGET_MS = Number(process.env.L8DB_CONVEX_STUDIO_OPEN_MS ?? 8000);
const SECTIONS = [
  "Übersicht",
  "Daten",
  "Funktionen",
  "Logs",
  "Dateien",
  "Zeitpläne",
  "Umgebung",
  "Einstellungen",
];
let browser: Browser;

type CountingWindow = {
  __invokes: string[];
  __TAURI_INTERNALS__: { invoke: (command: string, args?: Record<string, unknown>) => unknown };
};

async function openStudio(section: string, width = 1440) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await seedConvexStudio(page);
  await page.addInitScript(() => {
    const state = window as unknown as CountingWindow;
    state.__invokes = [];
    const invoke = state.__TAURI_INTERNALS__.invoke;
    state.__TAURI_INTERNALS__.invoke = (command, args) => {
      state.__invokes.push(command);
      return invoke(command, args);
    };
  });
  const started = performance.now();
  await page.goto(`${appUrl}/baas?${CONVEX_STUDIO_QUERY}&studio=${section}`);
  return { page, errors, started };
}

async function invokes(page: Page) {
  return page.evaluate(() => (window as unknown as CountingWindow).__invokes);
}

function count(list: string[], command: string) {
  return list.filter((entry) => entry === command).length;
}

beforeAll(async () => {
  if (enabled) browser = await chromium.launch();
});

afterAll(async () => {
  await browser?.close();
});

test.skipIf(!enabled)(
  "die Übersicht lädt Kennzahlen und Auffälligkeiten je einmal und zeigt die Umgebung",
  async () => {
    const samples: number[] = [];
    for (let run = 0; run < 3; run++) {
      const { page, errors, started } = await openStudio("overview");
      const main = page.locator("section[aria-label='Übersicht']");
      const insights = main.getByRole("region", { name: "Auffälligkeiten" });
      await insights.getByText("3×").waitFor();
      await main.getByRole("region", { name: "Kennzahlen" }).getByText("59.897").waitFor();
      samples.push(performance.now() - started);
      await page.locator("[data-baas-studio] > aside").getByText("Produktion").waitFor();
      await page.waitForTimeout(500);
      const calls = await invokes(page);
      expect(errors).toEqual([]);
      expect(await insights.getByRole("button").count()).toBe(4 + 2);
      expect(count(calls, "convex_studio_settings_info")).toBe(1);
      expect(count(calls, "convex_studio_settings_stats")).toBe(1);
      expect(count(calls, "convex_studio_settings_recent_errors")).toBe(1);
      expect(count(calls, "convex_studio_data_tables")).toBe(1);
      expect(count(calls, "convex_deployments")).toBe(1);
      expect(calls.filter((entry) => entry.startsWith("convex_studio")).length).toBe(4);
      await page.close();
    }
    samples.sort((a, b) => a - b);
    expect(samples[1]).toBeLessThan(OPEN_BUDGET_MS);
    await reportScenario("convex-studio-overview-open", {
      runs: samples.length,
      medianMs: samples[1],
      maxMs: samples[2],
    });
  },
  120_000,
);

test.skipIf(!enabled)(
  "die Navigation zeigt alle Bereiche beschriftet, auch in einem schmalen Fenster",
  async () => {
    for (const width of [1440, 1024]) {
      const { page, errors } = await openStudio("overview", width);
      const nav = page.getByRole("navigation", { name: "Convex Studio" });
      await nav.getByRole("tab", { name: "Einstellungen" }).waitFor();
      const frame = await nav.boundingBox();
      for (const label of SECTIONS) {
        const tab = nav.getByRole("tab", { name: label, exact: true });
        const box = await tab.boundingBox();
        expect(await tab.isEnabled()).toBe(true);
        expect(box && frame && box.x >= frame.x && box.x + box.width <= frame.x + frame.width).toBe(
          true,
        );
        expect(
          await tab
            .locator("span.truncate")
            .evaluate((node) => node.scrollWidth <= node.clientWidth),
        ).toBe(true);
      }
      expect(errors).toEqual([]);
      await page.close();
    }
  },
  60_000,
);

test.skipIf(!enabled)(
  "Daten und Funktionen öffnen ohne Zwischenschritt den ersten Eintrag",
  async () => {
    const data = await openStudio("data");
    await data.page
      .getByText(/^Nachricht 1 im/)
      .first()
      .waitFor();
    await data.page.waitForTimeout(500);
    const dataCalls = await invokes(data.page);
    expect(data.errors).toEqual([]);
    expect(count(dataCalls, "convex_studio_data_tables")).toBe(1);
    expect(count(dataCalls, "convex_studio_data_documents")).toBeLessThanOrEqual(2);
    await data.page.close();

    const functions = await openStudio("functions");
    const main = functions.page.locator("section[aria-label='Funktionen']");
    await main.getByText("messages.js:list").first().waitFor();
    await functions.page.waitForTimeout(500);
    const functionCalls = await invokes(functions.page);
    expect(functions.errors).toEqual([]);
    expect(count(functionCalls, "convex_studio_functions_list")).toBe(1);
    expect(count(functionCalls, "convex_studio_functions_detail")).toBeLessThanOrEqual(1);
    await functions.page.close();
  },
  60_000,
);

test.skipIf(!enabled)(
  "eine Auffälligkeit öffnet die Logs der Funktion, die Tabellenliste öffnet die Daten",
  async () => {
    const { page, errors } = await openStudio("overview");
    const main = page.locator("section[aria-label='Übersicht']");
    await main.getByRole("region", { name: "Auffälligkeiten" }).getByText("3×").click();
    await page.waitForURL(/studio=logs/);
    expect(new URL(page.url()).searchParams.get("logFunction")).toBe("users.js:current");
    const logs = page.locator("section[aria-label='Logs']");
    await logs.getByText("Uncaught Error").first().waitFor();
    expect(await logs.getByText("messages.js:send").count()).toBe(0);
    await page
      .locator("[data-baas-studio] [data-baas-context]")
      .getByRole("button", { name: /^users/ })
      .click();
    await page.waitForURL(/studio=data.*table=users|table=users.*studio=data/);
    await page.getByText("anna0@acme.io").first().waitFor();
    expect(errors).toEqual([]);
    await page.close();
  },
  60_000,
);
