import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { type Browser, chromium, type Page } from "playwright";
import type { IndexBuildProgress } from "../src/lib/db/replication";
import { interactionPercentiles, measureAppClick } from "./fixtures/perf-app-interactions";

const url = process.env.L8DB_TABLE_BROWSER_URL;
const run = url ? test : test.skip;
const waiting = "waiting for writers before build";
type Call = { command: string; database: string | null };
type Host = {
  calls: Call[];
  alphaProgress?: IndexBuildProgress;
  holdAlpha: boolean;
  releaseAlpha?: () => void;
  alphaReturned?: boolean;
};

let browser: Browser;
beforeAll(async () => {
  if (url) browser = await chromium.launch({ channel: process.env.L8DB_BROWSER_CHANNEL });
}, 30_000);
afterAll(async () => {
  await browser?.close();
}, 15_000);

async function fixture(sessions: number, width: number, colorScheme: "dark" | "light") {
  const context = await browser.newContext({
    colorScheme,
    viewport: { width, height: 900 },
    reducedMotion: "reduce",
  });
  await context.addInitScript(
    ({ sessions, waiting }) => {
      const host = window as unknown as Host;
      host.calls = [];
      host.holdAlpha = false;
      const initial: IndexBuildProgress = {
        command: "CREATE INDEX CONCURRENTLY",
        phase: waiting,
        counters: [{ unit: "lockers", done: "0", total: "1" }],
      };
      host.alphaProgress = initial;
      Object.assign(window, {
        __TAURI_INTERNALS__: {
          invoke: async (command: string, args?: { database?: string }) => {
            const database = args?.database ?? null;
            host.calls.push({ command, database });
            if (command === "list_sessions") {
              const indexProgress =
                database === "alpha"
                  ? host.alphaProgress
                  : database === "other"
                    ? initial
                    : undefined;
              const rows = Array.from(
                { length: database === "alpha" ? sessions : 2 },
                (_, index) => ({
                  pid: 8001 + index,
                  user: `fixture_${database}`,
                  database,
                  application: "fixture",
                  client_addr: null,
                  state: "active",
                  query:
                    index === 1 ? "CREATE INDEX CONCURRENTLY idx ON items (value)" : "SELECT 1",
                  query_start: null,
                  transaction_start: null,
                  wait_event: null,
                  is_self: false,
                  blocked_by: [] as number[],
                  ...(index === 1 && indexProgress ? { index_progress: indexProgress } : {}),
                }),
              );
              if (host.holdAlpha && database === "alpha") {
                host.holdAlpha = false;
                await new Promise<void>((resolve) => {
                  host.releaseAlpha = resolve;
                });
                host.alphaReturned = true;
              }
              return rows;
            }
            if (command === "get_database_overview")
              return { database, size_bytes: 0, size_pretty: "0 B", schemas: [] };
            if (command === "live_metrics")
              return {
                connections: sessions,
                max_connections: 1000,
                active_sessions: 2,
                waiting_locks: 0,
                database_size_bytes: null,
                commits: 0,
                rollbacks: 0,
                queries_read: null,
                queries_write: null,
                queries_other: null,
                rows_read: 0,
                rows_written: 0,
                blocks_read: 0,
                blocks_hit: 0,
                temp_bytes: 0,
                deadlocks: null,
                cpu_busy: null,
                cpu_total: null,
                server_version: "17.11",
                uptime_seconds: null,
                timezone: null,
                default_isolation: null,
                in_recovery: false,
                replay_delay_ms: null,
                replication: [],
                table_io: [],
              };
            return [];
          },
        },
      });
    },
    { sessions, waiting },
  );
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => {
    if (error.message !== "ResizeObserver loop completed with undelivered notifications.")
      errors.push(error.message);
  });
  page.setDefaultTimeout(8500);
  await page.goto(`${url}/tests/fixtures/index-progress-monitor.html`, { timeout: 45_000 });
  await openSessions(page);
  return { context, page, errors };
}

function progress(page: Page) {
  return page.getByRole("region", { name: "Indexfortschritt" });
}
function row(page: Page, pid: number) {
  return page
    .getByRole("row")
    .filter({ has: page.getByRole("cell", { name: String(pid), exact: true }) });
}
const calls = (page: Page) => page.evaluate(() => (window as unknown as Host).calls);
const sessionReads = (records: Call[], database: string) =>
  records.filter((call) => call.command === "list_sessions" && call.database === database).length;

async function openSessions(page: Page) {
  await page.getByRole("tab", { name: /^Sessions/ }).click();
  await row(page, 8002).waitFor();
}

run(
  "regular monitor associates native phase by session, removes it on poll, and ignores delayed old scopes",
  async () => {
    const { context, page, errors } = await fixture(2, 640, "dark");
    try {
      expect(sessionReads(await calls(page), "alpha")).toBe(1);
      expect(await progress(page).count()).toBe(0);
      await page.getByRole("button", { name: "Aktionen für PID 8002" }).press("Enter");
      await page.getByRole("menuitem", { name: "Details anzeigen" }).press("Enter");
      await progress(page).getByText(waiting, { exact: true }).waitFor();
      expect(await progress(page).getByText("0 / 1", { exact: true }).count()).toBe(1);
      expect(await progress(page).getByLabel("Zähler dieser Phase").innerText()).toContain(
        "Abgewartete Sperrhalter",
      );
      await mkdir("test-artifacts/browser", { recursive: true });
      await progress(page).screenshot({
        path: "test-artifacts/browser/index-progress-monitor.png",
      });
      expect(await progress(page).evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);

      await page.evaluate(() => {
        (window as unknown as Host).alphaProgress = undefined;
      });
      await progress(page).waitFor({ state: "hidden" });
      await row(page, 8002).waitFor();
      await page.getByRole("button", { name: "Aktualisierung pausieren", exact: true }).click();
      expect(sessionReads(await calls(page), "alpha")).toBe(2);

      const refresh = page.getByRole("button", { name: "Aktualisieren", exact: true });
      await page.evaluate(() => {
        (window as unknown as Host).alphaProgress = { phase: "unknown future phase", counters: [] };
      });
      await refresh.click();
      await progress(page).getByText("unknown future phase", { exact: true }).waitFor();
      expect(await progress(page).getByLabel("Zähler dieser Phase").count()).toBe(0);
      await page.evaluate(() => {
        const host = window as unknown as Host;
        host.alphaProgress = { phase: "old scope phase", counters: [] };
        host.holdAlpha = true;
      });
      await refresh.click();
      await page.waitForFunction(() => Boolean((window as unknown as Host).releaseAlpha));
      await page.getByRole("button", { name: "Beta", exact: true }).click();
      await openSessions(page);
      await row(page, 8002).click();
      await page.evaluate(() => (window as unknown as Host).releaseAlpha?.());
      await page.waitForFunction(() => Boolean((window as unknown as Host).alphaReturned));
      expect(await progress(page).count()).toBe(0);
      expect(await row(page, 8002).innerText()).toContain("fixture_beta");

      await page.getByRole("button", { name: "MySQL", exact: true }).click();
      await openSessions(page);
      await row(page, 8002).click();
      expect(await progress(page).count()).toBe(0);
      const records = await calls(page);
      expect(sessionReads(records, "alpha")).toBe(4);
      expect(sessionReads(records, "beta")).toBe(1);
      expect(sessionReads(records, "other")).toBe(1);
      expect(records.some(({ command }) => /^(execute_|cancel_|terminate_)/.test(command))).toBe(
        false,
      );
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  },
  70_000,
);

run(
  "progress details reuse the existing monitor payload for 750 sessions and add no idle requests",
  async () => {
    const { context, page, errors } = await fixture(750, 1460, "light");
    try {
      await page.getByRole("button", { name: "Aktualisierung pausieren", exact: true }).click();
      expect(await page.getByText("Aktive Sessions (750)", { exact: true }).count()).toBe(1);
      const rowCount = await page.locator("tbody > tr").count();
      expect(rowCount).toBe(200);
      const before = await calls(page);
      expect(sessionReads(before, "alpha")).toBe(1);
      const samples: number[] = [];
      for (let index = 0; index < 10; index++) {
        const elapsed = await measureAppClick(
          page,
          row(page, 8002),
          '[aria-label="Indexfortschritt"]',
        );
        if (index > 1) samples.push(elapsed);
        await row(page, 8001).click();
        await progress(page).waitFor({ state: "hidden" });
      }
      const latency = interactionPercentiles(samples);
      if (!process.env.CI) expect(latency.p95Ms).toBeLessThanOrEqual(120);
      await page.waitForTimeout(300);
      expect(await calls(page)).toEqual(before);
      console.log("A27 Sitzungsdetails", {
        ...latency,
        rowCount,
        additionalRequests: 0,
        idleMs: 300,
      });
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  },
  70_000,
);
