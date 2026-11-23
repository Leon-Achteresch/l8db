import { afterAll, beforeAll, expect, test } from "bun:test";
import { type Browser, chromium, type Page } from "playwright";
import type { DuckdbFilePathContext } from "../src/lib/db/duckdb-path-context";
import { interactionPercentiles, measureAppClick } from "./fixtures/perf-app-interactions";

const url = process.env.L8DB_TABLE_BROWSER_URL;
const run = url ? test : test.skip;
const command = "read_duckdb_file_path_context";
const title = "Relative Dateipfade in DuckDB";
const menuLabel = "DuckDB-Dateipfade…";
type Host = Window & {
  duckdbPathFixture: {
    sql: () => string;
    edit: (sql: string) => void;
    switchConnection: (id: string) => void;
    replaceConnection: () => void;
    setTransaction: (active: boolean) => void;
  };
  pathCalls: { command: string; connectionString?: string; database?: string }[];
  pathReply?: DuckdbFilePathContext | "error";
  releasePathReply?: () => void;
  pathReplyReleased?: boolean;
};
let browser: Browser;

beforeAll(async () => {
  if (url) browser = await chromium.launch({ channel: process.env.L8DB_BROWSER_CHANNEL });
}, 30_000);
afterAll(async () => {
  await browser?.close();
}, 15_000);

const toolbar = (page: Page) =>
  page.getByRole("button", { name: "Weitere Werkzeuge", exact: true });
const item = (page: Page) => page.getByRole("menuitem", { name: menuLabel, exact: true });
const dialog = (page: Page) => page.getByRole("dialog", { name: title });
const calls = (page: Page) => page.evaluate(() => (window as Host).pathCalls);
const pathCalls = async (page: Page) =>
  (await calls(page)).filter((entry) => entry.command === command);
const currentSql = (page: Page) => page.evaluate(() => (window as Host).duckdbPathFixture.sql());
const reply = (page: Page, data: DuckdbFilePathContext | "error") =>
  page.evaluate((data) => ((window as Host).pathReply = data), data);

async function openTools(page: Page) {
  await toolbar(page).press("Enter");
  await page.getByRole("menuitem", { name: "Editor-Werkzeuge", exact: true }).press("ArrowRight");
}

async function openHelp(page: Page) {
  await openTools(page);
  await item(page).press("Enter");
  await dialog(page).waitFor();
}

async function escapeHelp(page: Page) {
  await page.keyboard.press("Escape");
  await dialog(page).waitFor({ state: "hidden" });
  await toolbar(page).and(page.locator(":focus")).waitFor();
}

async function fixture(width: number, delay: boolean) {
  if (!url) throw Error("Missing isolated browser fixture");
  const context = await browser.newContext({
    viewport: { width, height: 710 },
    colorScheme: width < 500 ? "dark" : "light",
    reducedMotion: "reduce",
  });
  try {
    const origin = new URL(url).origin;
    await context.route("**/*", (route) =>
      new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
    );
    await context.addInitScript((delay) => {
      const host = window as Host;
      host.pathCalls = [];
      Object.assign(host, {
        __TAURI_INTERNALS__: {
          invoke: async (name: string, args?: { connectionString?: string; database?: string }) => {
            host.pathCalls.push({ command: name, ...args });
            if (/^(execute_|run_|stream_query)/.test(name)) throw Error(`Unexpected SQL: ${name}`);
            if (name !== "read_duckdb_file_path_context") return [];
            if (delay && args?.connectionString?.includes("synthetic-a")) {
              await new Promise<void>((resolve) => {
                host.releasePathReply = resolve;
              });
              host.pathReplyReleased = true;
            }
            if (host.pathReply === "error") throw Error("fixture command failure");
            return (
              host.pathReply ?? {
                state: "snapshot",
                file_search_path: args?.connectionString?.includes("synthetic-b")
                  ? "/fixture/b"
                  : "",
                working_directory: "/fixture/work",
              }
            );
          },
        },
      });
    }, delay);
    const page = await context.newPage();
    page.setDefaultTimeout(7500);
    const errors: string[] = [];
    page.on("pageerror", (error) => {
      if (error.message !== "ResizeObserver loop completed with undelivered notifications.")
        errors.push(error.message);
    });
    await page.goto(`${url}/tests/fixtures/duckdb-path-context.html`);
    await page.locator(".monaco-editor").first().waitFor();
    return { context, page, errors };
  } catch (error) {
    await context.close();
    throw error;
  }
}

run(
  "regular DuckDB editor shows one explicit read, raw paths, default and unknown values",
  async () => {
    const { context, page, errors } = await fixture(390, false);
    try {
      const source = await currentSql(page);
      await openTools(page);
      await item(page).waitFor();
      expect(await pathCalls(page)).toHaveLength(0);
      await item(page).press("Enter");
      await dialog(page).getByText("Leer · DuckDB nutzt das Arbeitsverzeichnis").waitFor();
      expect(await dialog(page).getByText("/fixture/work", { exact: true }).count()).toBe(1);
      expect(await pathCalls(page)).toEqual([
        { command, connectionString: "duckdb:///synthetic-a.duckdb" },
      ]);
      await escapeHelp(page);

      const multiRoot = "/fixture/first,/fixture/second";
      await reply(page, {
        state: "snapshot",
        file_search_path: multiRoot,
        working_directory: null,
      });
      await openHelp(page);
      await dialog(page).getByText(multiRoot, { exact: true }).waitFor();
      expect(await dialog(page).getByText("Unbekannt", { exact: true }).count()).toBe(1);
      const box = await dialog(page).boundingBox();
      expect(box?.x).toBeGreaterThanOrEqual(0);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390);
      if (process.env.L8DB_DUCKDB_PATH_SCREENSHOT) {
        await dialog(page).screenshot({ path: process.env.L8DB_DUCKDB_PATH_SCREENSHOT });
      }
      await escapeHelp(page);

      await reply(page, {
        state: "snapshot",
        file_search_path: null,
        working_directory: "/fixture/work",
      });
      await openHelp(page);
      await dialog(page).getByText("Unbekannt", { exact: true }).waitFor();
      expect(
        await dialog(page)
          .getByText(/DuckDB nutzt das Arbeitsverzeichnis/)
          .count(),
      ).toBe(0);
      await escapeHelp(page);
      for (const [state, text] of [
        ["no_session", /noch keine DuckDB-Sitzung/],
        ["busy", /gerade beschäftigt/],
        ["error", /konnte nicht ermittelt werden/],
      ] as const) {
        await reply(page, state === "error" ? state : { state });
        await openHelp(page);
        await dialog(page).getByRole("status").getByText(text).waitFor();
        await escapeHelp(page);
      }
      expect(await pathCalls(page)).toHaveLength(6);
      expect(await currentSql(page)).toBe(source);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  },
  42_000,
);

run(
  "late help result is scoped to the connection and managed transactions stay unknown",
  async () => {
    const { context, page, errors } = await fixture(1050, true);
    try {
      await openHelp(page);
      await dialog(page)
        .getByText(/wird gelesen/)
        .waitFor();
      await page.evaluate(() => (window as Host).duckdbPathFixture.switchConnection("duckdb-b"));
      await dialog(page).waitFor({ state: "hidden" });
      await openHelp(page);
      await dialog(page).getByText("/fixture/b", { exact: true }).waitFor();
      await page.evaluate(() => (window as Host).releasePathReply?.());
      await page.waitForFunction(() => (window as Host).pathReplyReleased);
      expect(
        await dialog(page)
          .getByText(/DuckDB nutzt das Arbeitsverzeichnis/)
          .count(),
      ).toBe(0);

      await page.evaluate(() => (window as Host).duckdbPathFixture.replaceConnection());
      await dialog(page).waitFor({ state: "hidden" });
      expect(await pathCalls(page)).toHaveLength(2);
      await page.evaluate(() => {
        const state = (window as Host).duckdbPathFixture;
        state.switchConnection("duckdb-a");
        state.setTransaction(true);
      });
      await openHelp(page);
      await dialog(page)
        .getByText(/verwaltete Transaktion nutzt eine eigene Sitzung/)
        .waitFor();
      expect(await pathCalls(page)).toHaveLength(2);
      await page.evaluate(() => (window as Host).duckdbPathFixture.setTransaction(false));
      await dialog(page).waitFor({ state: "hidden" });
      await page.evaluate(() => (window as Host).duckdbPathFixture.switchConnection("postgres"));
      await openTools(page);
      expect(await item(page).count()).toBe(0);
      expect(await pathCalls(page)).toHaveLength(2);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  },
  35_000,
);

run(
  "long SQL and a long search path keep opening bounded and never reread in idle",
  async () => {
    const { context, page, errors } = await fixture(1050, false);
    try {
      const source = "SELECT * FROM read_csv('sample.csv');\n".repeat(10_000);
      await page.evaluate((text) => (window as Host).duckdbPathFixture.edit(text), source);
      const filePaths = `/fixture/${"sample".repeat(1024)},/fixture/other`;
      await reply(page, {
        state: "snapshot",
        file_search_path: filePaths,
        working_directory: "/fixture/work",
      });
      const samples: number[] = [];
      let nodes = 0;
      for (let index = 0; index < 8; index++) {
        await openTools(page);
        const ms = await measureAppClick(page, item(page), '[role="dialog"] dl code');
        if (index > 1) samples.push(ms);
        nodes = Math.max(nodes, await dialog(page).locator("*").count());
        await escapeHelp(page);
      }
      const timing = interactionPercentiles(samples);
      expect(nodes).toBeLessThanOrEqual(25);
      if (!process.env.CI) expect(timing.p95Ms).toBeLessThanOrEqual(250);
      await page.waitForTimeout(300);
      expect(await pathCalls(page)).toHaveLength(8);
      expect(await currentSql(page)).toBe(source);
      expect(
        (await calls(page)).filter((entry) => /^(execute_|run_|stream_query)/.test(entry.command)),
      ).toEqual([]);
      expect(errors).toEqual([]);
      console.log("A35 browser", {
        sqlLines: 10_000,
        pathBytes: filePaths.length,
        ...timing,
        nodes,
        pathReadsPerOpen: 1,
      });
    } finally {
      await context.close();
    }
  },
  45_000,
);
