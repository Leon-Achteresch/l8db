import { afterAll, beforeAll, expect, test } from "bun:test";
import { type Browser, chromium, type Page } from "playwright";
import { reportScenario } from "../scripts/performance-report";
import { seedSupabaseStudio } from "./fixtures/supabase-studio-mock";

const enabled = Boolean(process.env.L8DB_SUPABASE_STUDIO_BROWSER);
const appUrl = process.env.L8DB_SUPABASE_STUDIO_URL ?? "http://localhost:1420";
const OPEN_BUDGET_MS = Number(process.env.L8DB_SUPABASE_STUDIO_OPEN_MS ?? 8000);
let browser: Browser;

type CountingWindow = {
  __invokes: string[];
  __TAURI_INTERNALS__: { invoke: (command: string, args?: Record<string, unknown>) => unknown };
};

async function openStudio(section: string) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await seedSupabaseStudio(page);
  await page.addInitScript(() => {
    const state = window as unknown as CountingWindow;
    state.__invokes = [];
    const invoke = state.__TAURI_INTERNALS__.invoke;
    state.__TAURI_INTERNALS__.invoke = (command, args) => {
      const kind = typeof args?.kind === "string" ? `:${args.kind}` : "";
      state.__invokes.push(`${command}${kind}`);
      return invoke(command, args);
    };
  });
  const started = performance.now();
  await page.goto(`${appUrl}/baas?provider=supabase&studio=${section}`);
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
  "die Übersicht lädt Status, Kennzahlen und RLS-Schutz je genau einmal",
  async () => {
    const samples: number[] = [];
    for (let run = 0; run < 3; run++) {
      const { page, errors, started } = await openStudio("overview");
      const main = page.locator("section[aria-label='Übersicht']");
      await main.getByText("Schutz der Tabellen in public").waitFor();
      await main.getByText("Geregelt", { exact: true }).waitFor();
      await main.getByRole("button", { name: /^Data API/ }).waitFor();
      samples.push(performance.now() - started);
      await page.waitForTimeout(500);
      const calls = await invokes(page);
      expect(errors).toEqual([]);
      expect(count(calls, "supabase_health")).toBe(1);
      expect(count(calls, "supabase_studio_settings_overview_stats")).toBe(1);
      expect(count(calls, "supabase_studio_database_list:rls_tables")).toBe(1);
      expect(count(calls, "supabase_studio_tables_schemas")).toBe(1);
      expect(count(calls, "supabase_studio_tables_list")).toBe(1);
      expect(calls.filter((entry) => entry.startsWith("supabase")).length).toBeLessThanOrEqual(8);
      await page.close();
    }
    samples.sort((a, b) => a - b);
    const median = samples[1];
    expect(median).toBeLessThan(OPEN_BUDGET_MS);
    await reportScenario("supabase-studio-overview-open", {
      runs: samples.length,
      medianMs: median,
      maxMs: samples[2],
    });
  },
  120_000,
);

test.skipIf(!enabled)(
  "die Tabellen-Landkarte teilt die Tabellenliste mit der Sidebar und bleibt begrenzt",
  async () => {
    const { page, errors } = await openStudio("tables");
    const map = page.getByRole("list", { name: "Tabellen in public nach Größe" });
    await map.waitFor();
    await page.waitForTimeout(500);
    const calls = await invokes(page);
    const tiles = await map.locator(":scope > li").count();
    expect(errors).toEqual([]);
    expect(count(calls, "supabase_studio_tables_list")).toBe(1);
    expect(tiles).toBeGreaterThan(0);
    expect(tiles).toBeLessThanOrEqual(60);
    await map.locator("button").first().click();
    await page.getByRole("tab", { name: "Spalten" }).waitFor();
    await page.close();
  },
  60_000,
);

test.skipIf(!enabled)(
  "die Zugriffsmatrix zeigt offene, gesperrte und geregelte Tabellen",
  async () => {
    const { page, errors } = await openStudio("policies");
    const main = page.locator("section[aria-label='Richtlinien']");
    await main.getByText("Geregelt", { exact: true }).waitFor();
    expect(await main.getByText("Ungeschützt: Data API ohne Zeilenfilter").count()).toBeGreaterThan(
      0,
    );
    expect(await main.getByText("SELECT geregelt").count()).toBeGreaterThan(0);
    expect(errors).toEqual([]);
    await page.close();
  },
  60_000,
);

test.skipIf(!enabled)(
  "die Sidebar führt wie bei einer Datenbank durch Tabellen und Unterbereiche",
  async () => {
    const { page, errors } = await openStudio("overview");
    const sidebar = page.locator("[data-baas-studio] > aside");
    await sidebar.getByRole("button", { name: "orders", exact: true }).click();
    await page.waitForURL(/studio=tables.*table=orders|table=orders.*studio=tables/);
    await page.getByRole("tab", { name: "Spalten" }).waitFor();
    const before = await invokes(page);
    await page.getByRole("tab", { name: "Datenbank" }).click();
    await sidebar.getByRole("tab", { name: "Indizes" }).click();
    await page.getByRole("heading", { name: /Datenbank\s*\/\s*Indizes/ }).waitFor();
    await page.getByRole("tab", { name: "Logs & Leistung" }).click();
    await sidebar.getByRole("tab", { name: "Sperren" }).click();
    await page.getByRole("heading", { name: /Logs & Leistung\s*\/\s*Sperren/ }).waitFor();
    const after = await invokes(page);
    expect(errors).toEqual([]);
    expect(
      count(after, "supabase_studio_tables_list") - count(before, "supabase_studio_tables_list"),
    ).toBe(0);
    await page.close();
  },
  60_000,
);
