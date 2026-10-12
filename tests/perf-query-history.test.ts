import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { chromium, webkit } from "playwright";
import { reportScenario } from "../scripts/performance-report";
import { seedApp } from "./fixtures/perf-app";
import { interactionPercentiles, measureAppClick } from "./fixtures/perf-app-interactions";
import {
  appRequestSnapshot,
  installAppRequestProbe,
  requestCounts,
  requestsSince,
  waitForAppMetadata,
} from "./fixtures/perf-app-requests";

test.skipIf(!process.env.L8DB_PERF_APP)(
  "Query-Verlauf bleibt bei 5000 Einträgen bedienbar",
  async () => {
    const dist = process.env.L8DB_PERF_DIST ?? "dist";
    const server = Bun.serve({
      port: 0,
      fetch: async (request) => {
        const pathname = new URL(request.url).pathname;
        const file = Bun.file(resolve(dist, pathname.replace(/^\//, "")));
        if (pathname !== "/" && (await file.exists())) return new Response(file);
        return new Response(Bun.file(resolve(dist, "index.html")), {
          headers: { "Content-Type": "text/html" },
        });
      },
    });
    const throttled = process.env.L8DB_PERF_ENGINE !== "webkit";
    const browser = await (throttled ? chromium : webkit).launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await seedApp(page, 3000);
      await installAppRequestProbe(page);
      await page.addInitScript(() => {
        localStorage.setItem(
          "l8db.query-history",
          JSON.stringify({
            state: {
              retentionLimit: 5000,
              entries: Array.from({ length: 5000 }, (_, index) => ({
                id: `query-perf-${index}`,
                connectionId: "perf",
                database: "l8db_perf",
                sql: `SELECT ${index} FROM table_0000`,
                ranAt: Date.now() - index * 1000,
                durationMs: index % 100,
                rowCount: index,
                error: null,
              })),
            },
            version: 0,
          }),
        );
        localStorage.setItem(
          "l8db.saved-queries",
          JSON.stringify({
            state: {
              queries: Array.from({ length: 5000 }, (_, index) => ({
                id: `saved-perf-${index}`,
                name: `Gespeichert ${index}`,
                sql: `SELECT ${index}`,
                createdAt: Date.now() - index * 1000,
              })),
            },
            version: 0,
          }),
        );
      });
      await page.goto(`http://localhost:${server.port}/query`);
      await page.locator('.monaco-editor[role="code"]').waitFor();
      await waitForAppMetadata(page, [
        "list_tables",
        "list_all_columns",
        "list_functions",
        "list_procedures",
      ]);
      await page.getByRole("button", { name: "Weitere Werkzeuge" }).click();
      const operationsBefore = await appRequestSnapshot(page);
      const cdp = throttled ? await page.context().newCDPSession(page) : null;
      if (throttled) {
        await cdp?.send("Emulation.setCPUThrottlingRate", { rate: 4 });
        await page.evaluate(() => {
          const durations: number[] = [];
          Object.assign(window, { __historyClickDurations: durations });
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              if (entry.name === "click") durations.push(entry.duration);
            }
          }).observe({ type: "event", durationThreshold: 16 });
        });
      }
      const tracePath = process.env.L8DB_PERF_HISTORY_TRACE;
      const traceInvalidations = process.env.L8DB_PERF_HISTORY_TRACE_INVALIDATIONS !== "0";
      if (tracePath && cdp) {
        await cdp.send("Tracing.start", {
          categories: traceInvalidations
            ? "devtools.timeline,disabled-by-default-devtools.timeline.invalidationTracking"
            : "devtools.timeline",
          transferMode: "ReturnAsStream",
        });
        await cdp.send("Profiler.enable");
        await cdp.send("Profiler.setSamplingInterval", { interval: 1000 });
        await cdp.send("Profiler.start");
      }
      const coldOpenMs = await measureAppClick(
        page,
        page.getByRole("menuitem", { name: /Verlauf & Gespeichertes/ }),
        '[data-slot="query-history-dialog"] [data-slot="query-history-list"] [data-index="0"]',
      );
      await page.getByRole("dialog", { name: "Verlauf & Gespeichertes" }).waitFor();
      await page.getByText("SELECT 0 FROM table_0000", { exact: true }).waitFor();
      if (tracePath && cdp) {
        const { profile } = await cdp.send("Profiler.stop");
        await Bun.write(`${tracePath}.cpu.json`, JSON.stringify(profile));
        const complete = new Promise<{ stream: string }>((resolve) =>
          cdp.once("Tracing.tracingComplete", resolve),
        );
        await cdp.send("Tracing.end");
        const { stream } = await complete;
        let source = "";
        for (;;) {
          const part = await cdp.send("IO.read", { handle: stream });
          source += part.data;
          if (part.eof) break;
        }
        await cdp.send("IO.close", { handle: stream });
        await Bun.write(tracePath, source);
      }
      const initial = await page.evaluate(() => ({
        nodes: document.querySelectorAll("*").length,
        entries: document.querySelectorAll('[data-slot="query-history-list"] [data-index]').length,
      }));
      expect(initial.nodes).toBeLessThan(5000);
      expect(initial.entries).toBeLessThan(100);
      if (throttled) {
        await page.waitForTimeout(100);
        const durations = await page.evaluate(
          () =>
            (window as unknown as { __historyClickDurations: number[] }).__historyClickDurations,
        );
        expect(durations.length).toBeGreaterThan(0);
        const worst = Math.max(...durations);
        console.log(`perf query history: ${worst} ms Klick, ${initial.nodes} DOM-Knoten`);
      }
      const list = page.locator('[data-slot="query-history-list"]');
      expect(await list.getByRole("button").count()).toBeLessThanOrEqual(initial.entries + 4);
      const entry = list.locator('[data-index="0"]');
      await entry.getByTitle("In neuem SQL-Tab öffnen").focus();
      await entry.getByRole("button", { name: "Neuer Tab", exact: true }).waitFor();
      await page.keyboard.press("Tab");
      expect(
        await entry
          .getByRole("button", { name: "Neuer Tab", exact: true })
          .evaluate((element) => element === document.activeElement),
      ).toBe(true);
      await page.keyboard.press("Tab");
      expect(
        await entry
          .getByRole("button", { name: "Editor ersetzen", exact: true })
          .evaluate((element) => element === document.activeElement),
      ).toBe(true);
      await page.getByRole("textbox", { name: "Query-Verlauf durchsuchen" }).focus();
      await page.mouse.move(20, 450);
      await entry
        .getByRole("button", { name: "Editor ersetzen", exact: true })
        .waitFor({ state: "detached" });
      const actions = await page.evaluate(async () => {
        const row = document.querySelector<HTMLElement>(
          '[data-slot="query-history-list"] [data-index="0"]',
        );
        const input = document.querySelector<HTMLInputElement>(
          '[aria-label="Query-Verlauf durchsuchen"]',
        );
        if (!row || !input) throw new Error("history controls missing");
        const samples: number[] = [];
        for (let turn = 0; turn < 11; turn++) {
          input.focus();
          await new Promise(requestAnimationFrame);
          const started = performance.now();
          await new Promise<void>((resolve) => {
            const observer = new MutationObserver(() => {
              if (row.querySelectorAll("button").length < 2) return;
              observer.disconnect();
              requestAnimationFrame(() => resolve());
            });
            observer.observe(row, { childList: true, subtree: true });
            row.querySelector("button")?.focus();
          });
          if (turn > 1) samples.push(performance.now() - started);
        }
        input.focus();
        await new Promise(requestAnimationFrame);
        samples.sort((a, b) => a - b);
        return {
          medianMs: samples[4],
          p95Ms: samples[8],
          retainedActionButtons: row.querySelectorAll("button").length - 1,
        };
      });
      expect(actions.retainedActionButtons).toBe(0);
      await list.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      await page.getByText("SELECT 4999 FROM table_0000", { exact: true }).waitFor();
      await page.getByRole("textbox", { name: "Query-Verlauf durchsuchen" }).fill("SELECT 4999");
      await page.getByText("SELECT 4999 FROM table_0000", { exact: true }).waitFor();
      await page.getByRole("textbox", { name: "Query-Verlauf durchsuchen" }).fill("");
      await page
        .getByRole("radiogroup", { name: "Query-Bibliothek" })
        .getByText("Gespeichert")
        .click();
      await page.getByText("Gespeichert 0", { exact: true }).waitFor();
      await list.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      await page.getByText("Gespeichert 4999", { exact: true }).waitFor();
      expect(await page.evaluate(() => document.querySelectorAll("*").length)).toBeLessThan(5000);
      await page
        .getByRole("textbox", { name: "Query-Verlauf durchsuchen" })
        .fill("Gespeichert 4999");
      await page.getByText("Gespeichert 4999", { exact: true }).waitFor();
      const openSamples: number[] = [];
      for (let turn = 0; turn < 11; turn++) {
        await page.keyboard.press("Escape");
        await page.getByRole("dialog", { name: "Verlauf & Gespeichertes" }).waitFor({
          state: "detached",
        });
        await page.getByRole("button", { name: "Weitere Werkzeuge" }).click();
        const duration = await measureAppClick(
          page,
          page.getByRole("menuitem", { name: /Verlauf & Gespeichertes/ }),
          '[data-slot="query-history-dialog"] [data-slot="query-history-list"] [data-index="0"]',
        );
        if (turn > 1) openSamples.push(duration);
        await page.getByRole("textbox", { name: "Query-Verlauf durchsuchen" }).waitFor();
      }
      const opens = interactionPercentiles(openSamples);
      let worstClickMs: number | null = null;
      if (throttled) {
        await page.waitForTimeout(100);
        const durations = await page.evaluate(
          () =>
            (window as unknown as { __historyClickDurations: number[] }).__historyClickDurations,
        );
        console.log(`perf query history actions: ${durations.join(", ")} ms`);
        worstClickMs = Math.max(...durations);
      }
      const idleBefore = await appRequestSnapshot(page);
      await page.waitForTimeout(300);
      const idleAfter = await appRequestSnapshot(page);
      const operations = requestsSince(operationsBefore, idleBefore);
      const idle = requestsSince(idleBefore, idleAfter);
      await reportScenario(`query-history-${throttled ? "chromium" : "webkit"}`, {
        browser: browser.version(),
        cpuRate: throttled ? 4 : 1,
        historyEntries: 5000,
        savedEntries: 5000,
        ...initial,
        actions,
        coldOpenMs,
        coldInstrumentation: tracePath
          ? `${traceInvalidations ? "invalidation" : "timeline"} tracing and CPU sampling`
          : null,
        opens,
        startupCommands: requestCounts(operationsBefore.calls),
        operations,
        idleDurationMs: 300,
        idle,
        activeDatabaseRequests: idleAfter.activeDatabaseRequests,
        maxDatabaseConcurrency: idleAfter.maxDatabaseConcurrency,
        worstClickMs,
      });
      expect(operations.databaseRequests).toBe(0);
      expect(operations.unknownRequests).toBe(0);
      expect(idle.databaseRequests).toBe(0);
      expect(idle.unknownRequests).toBe(0);
      expect(idleAfter.activeDatabaseRequests).toBe(0);
      expect(actions.p95Ms).toBeLessThan(120);
      expect(coldOpenMs).toBeLessThanOrEqual(120);
      expect(opens.p95Ms).toBeLessThanOrEqual(120);
      if (worstClickMs !== null) expect(worstClickMs).toBeLessThanOrEqual(120);
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
