import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { chromium, webkit } from "playwright";
import { reportScenario } from "../scripts/performance-report";
import { seedApp } from "./fixtures/perf-app";
import { interactionPercentiles } from "./fixtures/perf-app-interactions";
import {
  appRequestSnapshot,
  installAppRequestProbe,
  requestsSince,
} from "./fixtures/perf-app-requests";
import { installQueryTransferFixture } from "./fixtures/perf-query-transfer";

function serveApplication() {
  const dist = resolve(process.env.L8DB_PERF_DIST ?? "dist");
  return Bun.serve({
    port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname;
      const asset = Bun.file(resolve(dist, path.slice(1)));
      return new Response(
        path !== "/" && (await asset.exists()) ? asset : Bun.file(resolve(dist, "index.html")),
      );
    },
  });
}

test.skipIf(!process.env.L8DB_PERF_APP)(
  "palette commands load on demand once and reopening reuses metadata without idle reads",
  async () => {
    const server = serveApplication();
    const engine = process.env.L8DB_PERF_ENGINE === "webkit" ? "webkit" : "chromium";
    const browser = await (engine === "webkit" ? webkit : chromium).launch({ headless: true });
    let releaseModule = () => {};
    try {
      const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
      const modules: string[] = [];
      const errors: string[] = [];
      page.on("request", (request) => {
        if (/\/command-items-[^/]+\.js$/.test(request.url())) modules.push(request.url());
      });
      page.on("pageerror", (error) => errors.push(error.message));
      const moduleGate = new Promise<void>((resolve) => {
        releaseModule = resolve;
      });
      await page.route(/\/command-items-[^/]+\.js$/, async (route) => {
        await moduleGate;
        await route.continue();
      });
      await seedApp(page, 3000);
      await page.addInitScript(() => {
        const calls: string[] = [];
        const state = window as unknown as {
          __TAURI_INTERNALS__: { invoke: (command: string, args?: unknown) => Promise<unknown> };
          paletteCalls: string[];
          paletteDurations: number[];
        };
        const invoke = state.__TAURI_INTERNALS__.invoke;
        state.__TAURI_INTERNALS__.invoke = (command, args) => {
          calls.push(command);
          return invoke(command, args);
        };
        state.paletteCalls = calls;
        state.paletteDurations = [];
        let pending: MutationObserver | undefined;
        document.addEventListener(
          "keydown",
          (event) => {
            if (event.key === "Escape") {
              pending?.disconnect();
              pending = undefined;
              return;
            }
            if (event.key.toLowerCase() !== "k" || !(event.ctrlKey || event.metaKey)) return;
            const started = performance.now();
            performance.mark(`palette-start-${state.paletteDurations.length}`);
            pending?.disconnect();
            const observer = new MutationObserver(() => {
              if (!document.querySelector('[aria-label="Command palette"] [role="option"]')) return;
              observer.disconnect();
              requestAnimationFrame(() => {
                performance.mark(`palette-frame-${state.paletteDurations.length}`);
                state.paletteDurations.push(performance.now() - started);
              });
            });
            pending = observer;
            observer.observe(document.body, { childList: true, subtree: true });
          },
          true,
        );
      });
      await page.goto(`http://localhost:${server.port}/`);
      const paletteHotkey = await page.evaluate(() =>
        /mac/i.test(`${navigator.platform} ${navigator.userAgent}`) ? "Meta+k" : "Control+k",
      );
      await page.locator('a[data-name="table_0000"]').waitFor();
      await page.waitForTimeout(300);
      expect(modules).toHaveLength(0);
      const readsBeforeModuleLoad = await page.evaluate(
        () =>
          (window as unknown as { paletteCalls: string[] }).paletteCalls.filter((command) =>
            ["list_tables", "list_views", "list_functions", "list_procedures"].includes(command),
          ).length,
      );
      await page.keyboard.press(paletteHotkey);
      const palette = page.getByRole("dialog", { name: "Command palette" });
      await palette.waitFor();
      expect(await palette.locator('[role="option"]').count()).toBe(0);
      await page.keyboard.press("Escape");
      await palette.waitFor({ state: "hidden" });
      expect(
        await page.evaluate(
          () =>
            (window as unknown as { paletteCalls: string[] }).paletteCalls.filter((command) =>
              ["list_tables", "list_views", "list_functions", "list_procedures"].includes(command),
            ).length,
        ),
      ).toBe(readsBeforeModuleLoad);
      const moduleResponse = page.waitForResponse(/\/command-items-[^/]+\.js$/);
      releaseModule();
      await moduleResponse;
      await page.waitForTimeout(100);
      expect(await page.locator('[aria-label="Command palette"] [role="option"]').count()).toBe(0);
      const coldStarted = performance.now();
      await page.keyboard.press(paletteHotkey);
      await palette.locator('[role="option"]').first().waitFor();
      const coldOpenMs = performance.now() - coldStarted;
      expect(coldOpenMs).toBeLessThan(1000);
      expect(modules).toHaveLength(1);
      await palette.getByRole("combobox").fill("Oberflächengröße");
      await palette.getByRole("option", { name: /^Oberflächengröße Darstellung$/ }).waitFor();
      await page.keyboard.press("Escape");
      await palette.waitFor({ state: "hidden" });
      const profiler = engine === "chromium" ? await page.context().newCDPSession(page) : null;
      await profiler?.send("Emulation.setCPUThrottlingRate", { rate: 4 });
      await profiler?.send("HeapProfiler.collectGarbage");
      const heapBefore = (await profiler?.send("Runtime.getHeapUsage"))?.usedSize ?? null;
      const readsBefore = await page.evaluate(
        () =>
          (window as unknown as { paletteCalls: string[] }).paletteCalls.filter((command) =>
            ["list_tables", "list_views", "list_functions", "list_procedures"].includes(command),
          ).length,
      );
      const traceEvents: unknown[] = [];
      const tracing = Boolean(process.env.L8DB_PERF_TRACE && profiler);
      if (tracing && profiler) {
        profiler.on("Tracing.dataCollected", ({ value }) => traceEvents.push(...value));
        await profiler.send("Tracing.start", {
          categories:
            "devtools.timeline,blink.user_timing,disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.invalidationTracking",
          transferMode: "ReportEvents",
        });
      }
      if (process.env.L8DB_PERF_PROFILE && profiler) {
        await profiler.send("Profiler.enable");
        await profiler.send("Profiler.start");
      }
      for (let index = 0; index < 9; index++) {
        await page.keyboard.press(paletteHotkey);
        await palette.locator('[role="option"]').first().waitFor();
        await page.waitForFunction(
          (count) =>
            (window as unknown as { paletteDurations: number[] }).paletteDurations.length >= count,
          index + 2,
        );
        expect(await palette.locator('[role="option"]').count()).toBeLessThanOrEqual(30);
        expect(
          await palette.locator('[role="option"][aria-selected="true"]').getAttribute("data-index"),
        ).toBe("0");
        expect(await palette.getByRole("listbox").evaluate((list) => list.scrollTop)).toBe(0);
        if (index === 0) {
          for (let step = 0; step < 59; step++) await page.keyboard.press("ArrowDown");
          const selected = palette.locator('[role="option"][aria-selected="true"]');
          expect(await selected.getAttribute("data-index")).toBe("59");
          expect(await selected.getAttribute("id")).toBe(
            await palette.getByRole("combobox").getAttribute("aria-activedescendant"),
          );
          expect(
            await selected.evaluate((element) => {
              const box = element.getBoundingClientRect();
              const list = element.closest('[role="listbox"]')?.getBoundingClientRect();
              return list && box.top >= list.top && box.bottom <= list.bottom;
            }),
          ).toBe(true);
        }
        await page.keyboard.press("Escape");
        await palette.waitFor({ state: "hidden" });
      }
      await page.keyboard.press(paletteHotkey);
      await palette.locator('[role="option"]').first().waitFor();
      for (let cycle = 0; cycle < 3; cycle++) {
        for (let step = 0; step < 59; step++) await page.keyboard.press("ArrowDown");
        expect(
          await palette.getByRole("listbox").evaluate((list) => list.scrollTop),
        ).toBeGreaterThan(0);
        await page.evaluate(() => {
          const list = document.querySelector('[aria-label="Command palette"] [role="listbox"]');
          Object.assign(window, { paletteExitList: new WeakRef(list as HTMLDivElement) });
        });
        await page.keyboard.press("Escape");
        await page.evaluate(
          () =>
            new Promise<void>((resolve) => {
              requestAnimationFrame(() => {
                const mac = /mac/i.test(`${navigator.platform} ${navigator.userAgent}`);
                document.dispatchEvent(
                  new KeyboardEvent("keydown", {
                    key: "k",
                    code: "KeyK",
                    ctrlKey: !mac,
                    metaKey: mac,
                    bubbles: true,
                  }),
                );
                resolve();
              });
            }),
        );
        await palette.locator('[role="option"]').first().waitFor();
        expect(
          await page.evaluate(() => {
            const state = window as unknown as { paletteExitList: WeakRef<HTMLDivElement> };
            return (
              state.paletteExitList.deref() ===
              document.querySelector('[aria-label="Command palette"] [role="listbox"]')
            );
          }),
        ).toBe(true);
        await page.waitForFunction(() => {
          const selected = document.querySelector(
            '[aria-label="Command palette"] [role="option"][aria-selected="true"]',
          );
          const list = selected?.closest('[role="listbox"]');
          return selected?.getAttribute("data-index") === "0" && list?.scrollTop === 0;
        });
      }
      await page.setViewportSize({ width: 700, height: 540 });
      await page.waitForFunction(() => {
        const panel = document.querySelector('[aria-label="Command palette"]');
        const box = panel?.getBoundingClientRect();
        return (
          box &&
          box.left >= 0 &&
          box.top >= 0 &&
          box.right <= innerWidth &&
          box.bottom <= innerHeight
        );
      });
      expect(await palette.locator('[role="option"]').count()).toBeLessThanOrEqual(30);
      for (let step = 0; step < 59; step++) await page.keyboard.press("ArrowDown");
      const resizedSelected = palette.locator('[role="option"][aria-selected="true"]');
      expect(await resizedSelected.getAttribute("data-index")).toBe("59");
      expect(await resizedSelected.getAttribute("id")).toBe(
        await palette.getByRole("combobox").getAttribute("aria-activedescendant"),
      );
      expect(
        await resizedSelected.evaluate((element) => {
          const box = element.getBoundingClientRect();
          const list = element.closest('[role="listbox"]')?.getBoundingClientRect();
          return list && box.top >= list.top && box.bottom <= list.bottom;
        }),
      ).toBe(true);
      expect(await page.locator("[data-command-palette-portal]").count()).toBe(1);
      await page.keyboard.press("Escape");
      await page.locator('[aria-label="Command palette"]').waitFor({ state: "detached" });
      expect(await page.locator("[data-command-palette-portal]").count()).toBe(1);
      if (process.env.L8DB_PERF_PROFILE && profiler) {
        const profile = await profiler.send("Profiler.stop");
        await Bun.write("/tmp/l8db-palette.cpuprofile", JSON.stringify(profile.profile));
      }
      if (tracing && profiler) {
        const complete = new Promise<void>((resolve) =>
          profiler.once("Tracing.tracingComplete", resolve),
        );
        await profiler.send("Tracing.end");
        await complete;
        await Bun.write("/tmp/l8db-palette.trace.json", JSON.stringify({ traceEvents }));
      }
      await page.waitForTimeout(300);
      await profiler?.send("HeapProfiler.collectGarbage");
      const heapAfter = (await profiler?.send("Runtime.getHeapUsage"))?.usedSize ?? null;
      const retainedHeapGrowthBytes =
        heapAfter === null || heapBefore === null ? null : Math.max(0, heapAfter - heapBefore);
      const result = await page.evaluate(() => {
        const state = window as unknown as { paletteCalls: string[]; paletteDurations: number[] };
        const durations = state.paletteDurations
          .slice(1, 10)
          .toSorted((left, right) => left - right);
        return {
          medianMs: durations[4],
          p95Ms: durations[8],
          nodes: document.querySelectorAll("*").length,
          reads: state.paletteCalls.filter((command) =>
            ["list_tables", "list_views", "list_functions", "list_procedures"].includes(command),
          ).length,
          samplesMs: durations,
          documentHeight: document.documentElement.scrollHeight,
          viewportHeight: document.documentElement.clientHeight,
        };
      });
      await reportScenario(`palette-loading-${engine}`, {
        browser: browser.version(),
        cpuRate: engine === "chromium" ? 4 : 1,
        tables: 3000,
        coldOpenMs,
        ...result,
        warmMetadataReads: result.reads - readsBefore,
        commandModuleLoads: modules.length,
        retainedHeapGrowthBytes,
        profilingEnabled: Boolean(process.env.L8DB_PERF_PROFILE),
        abandonedModuleLoads: 1,
        metadataReadsDuringModuleLoading: 0,
        rapidExitReopen: true,
        rapidExitReopenCycles: 3,
        rapidReopenCursorReset: true,
        rapidReopenScrollReset: true,
        resizedLastLogicalItemVisible: true,
        resizedViewport: { width: 700, height: 540 },
      });
      expect(result.samplesMs).toHaveLength(9);
      expect(result.reads).toBe(readsBefore);
      expect(modules).toHaveLength(1);
      expect(result.nodes).toBeLessThan(6000);
      expect(result.p95Ms).toBeLessThan(120);
      if (retainedHeapGrowthBytes !== null)
        expect(retainedHeapGrowthBytes).toBeLessThan(16 * 1024 * 1024);
      expect(errors).toEqual([]);
    } finally {
      releaseModule();
      await browser.close();
      server.stop(true);
    }
  },
  60000,
);

test.skipIf(!process.env.L8DB_PERF_APP)(
  "palette close cancels delayed metadata and drops queued reads before a cached warm reopen",
  async () => {
    const server = serveApplication();
    const engine = process.env.L8DB_PERF_ENGINE === "webkit" ? "webkit" : "chromium";
    const browser = await (engine === "webkit" ? webkit : chromium).launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await seedApp(page, 3000);
      await page.addInitScript(() => {
        const state = window as unknown as {
          __TAURI_INTERNALS__: {
            invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
          };
          paletteMetadata: {
            calls: string[];
            cancelled: string[];
            active: number;
            maxConcurrency: number;
            held: boolean;
            release: () => void;
          };
        };
        const invoke = state.__TAURI_INTERNALS__.invoke;
        const pending = new Map<string, { finish: () => void; cancel: () => void }>();
        const probe = {
          calls: [] as string[],
          cancelled: [] as string[],
          active: 0,
          maxConcurrency: 0,
          held: true,
          release: () => {
            probe.held = false;
            for (const job of [...pending.values()]) job.finish();
          },
        };
        state.paletteMetadata = probe;
        state.__TAURI_INTERNALS__.invoke = (command, args) => {
          if (command === "cancel_execution") {
            const id = String(args?.jobId ?? "");
            const job = pending.get(id);
            if (!job) return invoke(command, args);
            probe.cancelled.push(id);
            job.cancel();
            return Promise.resolve(true);
          }
          const jobId = (args?.options as { jobId?: string } | undefined)?.jobId;
          if (
            !jobId ||
            !["list_tables", "list_views", "list_functions", "list_procedures"].includes(command)
          )
            return invoke(command, args);
          probe.calls.push(command);
          probe.active++;
          probe.maxConcurrency = Math.max(probe.maxConcurrency, probe.active);
          const operation = new Promise<unknown>((resolve, reject) => {
            const finish = () => {
              void invoke(command, args).then(resolve, reject);
            };
            pending.set(jobId, {
              finish,
              cancel: () => reject(new Error("Abfrage vom Server abgebrochen")),
            });
            if (!probe.held) finish();
          });
          return operation.finally(() => {
            pending.delete(jobId);
            probe.active--;
          });
        };
      });
      await page.goto(`http://localhost:${server.port}/`);
      await page.locator('a[data-name="table_0000"]').waitFor();
      const hotkey = await page.evaluate(() =>
        /mac/i.test(`${navigator.platform} ${navigator.userAgent}`) ? "Meta+k" : "Control+k",
      );
      const profiler = engine === "chromium" ? await page.context().newCDPSession(page) : null;
      await profiler?.send("Emulation.setCPUThrottlingRate", { rate: 4 });
      await page.keyboard.press(hotkey);
      const palette = page.getByRole("dialog", { name: "Command palette" });
      await palette.waitFor();
      await page.waitForFunction(
        () =>
          (window as unknown as { paletteMetadata: { calls: string[] } }).paletteMetadata.calls
            .length === 2,
      );
      await page.keyboard.press("Escape");
      await palette.waitFor({ state: "hidden" });
      await page.waitForFunction(() => {
        const probe = (
          window as unknown as { paletteMetadata: { active: number; cancelled: string[] } }
        ).paletteMetadata;
        return probe.active === 0 && probe.cancelled.length === 2;
      });
      await page.waitForTimeout(150);
      const abandoned = await page.evaluate(() => {
        const probe = (
          window as unknown as {
            paletteMetadata: {
              calls: string[];
              cancelled: string[];
              active: number;
              maxConcurrency: number;
            };
          }
        ).paletteMetadata;
        return {
          calls: [...probe.calls],
          cancelled: probe.cancelled.length,
          active: probe.active,
          maxConcurrency: probe.maxConcurrency,
        };
      });
      expect(abandoned.calls).toEqual(["list_tables", "list_views"]);
      expect(abandoned.cancelled).toBe(2);
      expect(abandoned.active).toBe(0);
      expect(abandoned.maxConcurrency).toBe(2);
      await page.evaluate(() =>
        (
          window as unknown as { paletteMetadata: { release: () => void } }
        ).paletteMetadata.release(),
      );
      await page.keyboard.press(hotkey);
      await palette.getByRole("combobox").fill("fn_table_0899");
      await palette
        .getByRole("option", { name: /^fn_table_0899/ })
        .first()
        .waitFor();
      const loaded = await page.evaluate(() => {
        const probe = (
          window as unknown as {
            paletteMetadata: { calls: string[]; active: number; maxConcurrency: number };
          }
        ).paletteMetadata;
        return {
          calls: probe.calls.length,
          active: probe.active,
          maxConcurrency: probe.maxConcurrency,
        };
      });
      expect(loaded.calls).toBe(6);
      expect(loaded.active).toBe(0);
      expect(loaded.maxConcurrency).toBe(2);
      await page.keyboard.press("Escape");
      await palette.waitFor({ state: "hidden" });
      for (let index = 0; index < 3; index++) {
        await page.keyboard.press(hotkey);
        await palette.locator('[role="option"]').first().waitFor();
        await page.keyboard.press("Escape");
        await palette.waitFor({ state: "hidden" });
      }
      await page.waitForTimeout(300);
      const final = await page.evaluate(() => {
        const probe = (
          window as unknown as { paletteMetadata: { calls: string[]; active: number } }
        ).paletteMetadata;
        return { calls: probe.calls.length, active: probe.active };
      });
      expect(final).toEqual({ calls: 6, active: 0 });
      await reportScenario(`palette-metadata-cancellation-${engine}`, {
        browser: browser.version(),
        cpuRate: engine === "chromium" ? 4 : 1,
        tables: 3000,
        delayedReads: abandoned.calls.length,
        cancelledReads: abandoned.cancelled,
        queuedReadsDispatched: 0,
        maxConcurrency: loaded.maxConcurrency,
        warmReopens: 3,
        warmMetadataReads: final.calls - loaded.calls,
        idleReads: 0,
        retainedJobs: final.active,
      });
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
      server.stop(true);
    }
  },
  45000,
);

test.skipIf(!process.env.L8DB_PERF_APP)(
  "palette stays interactive in query history and restores its host and focus without warm reads",
  async () => {
    const server = serveApplication();
    const engine = process.env.L8DB_PERF_ENGINE === "webkit" ? "webkit" : "chromium";
    const browser = await (engine === "webkit" ? webkit : chromium).launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await seedApp(page, 3000);
      await installQueryTransferFixture(page);
      await installAppRequestProbe(page);
      await page.addInitScript(() => {
        const state = window as unknown as { historyPaletteDurations: number[] };
        state.historyPaletteDurations = [];
        let pending: MutationObserver | undefined;
        document.addEventListener(
          "keydown",
          (event) => {
            if (event.key === "Escape") {
              pending?.disconnect();
              pending = undefined;
              return;
            }
            if (event.key.toLowerCase() !== "k" || !(event.ctrlKey || event.metaKey)) return;
            const started = performance.now();
            pending?.disconnect();
            const observer = new MutationObserver(() => {
              const option = document.querySelector(
                '[aria-label="Command palette"] [role="option"]',
              );
              if (!option || option.closest("[inert]")) return;
              observer.disconnect();
              requestAnimationFrame(() => {
                state.historyPaletteDurations.push(performance.now() - started);
              });
            });
            pending = observer;
            observer.observe(document.body, { childList: true, subtree: true });
          },
          true,
        );
      });
      await page.goto(`http://localhost:${server.port}/query`);
      await page.locator('.monaco-editor[role="code"]').waitFor();
      await page.waitForTimeout(500);
      const hotkey = await page.evaluate(() =>
        /mac/i.test(`${navigator.platform} ${navigator.userAgent}`) ? "Meta+k" : "Control+k",
      );
      const cdp = engine === "chromium" ? await page.context().newCDPSession(page) : null;
      await cdp?.send("Emulation.setCPUThrottlingRate", { rate: 4 });
      const tools = page.getByRole("button", { name: "Weitere Werkzeuge" });
      await tools.click();
      await page.getByRole("menuitem", { name: /Verlauf & Gespeichertes/ }).click();
      const history = page.locator('[data-slot="query-history-dialog"]');
      const historyInput = history.getByRole("textbox", { name: "Query-Verlauf durchsuchen" });
      const palette = page.getByRole("dialog", { name: "Command palette" });
      await historyInput.waitFor();
      expect(await history.evaluate((element) => element.tagName)).toBe("DIV");
      expect(await history.getAttribute("aria-modal")).toBe("true");
      expect(
        await history.evaluate((element) => element.getAttribute("data-state") === "open"),
      ).toBe(true);
      expect(await historyInput.evaluate((element) => element === document.activeElement)).toBe(
        true,
      );
      await page.keyboard.press(hotkey);
      await palette.locator('[role="option"]').first().waitFor();
      await page.waitForFunction(
        () =>
          (window as unknown as { historyPaletteDurations: number[] }).historyPaletteDurations
            .length === 1,
      );
      expect(
        await palette.evaluate((element) => {
          const box = element.getBoundingClientRect();
          const hit = document.elementFromPoint(box.left + box.width / 2, box.top + 24);
          return (
            element.closest('[data-slot="query-history-dialog"]')?.getAttribute("data-state") ===
              "open" &&
            element.contains(hit) &&
            box.left >= 0 &&
            box.right <= innerWidth
          );
        }),
      ).toBe(true);
      expect(
        await palette
          .getByRole("combobox")
          .evaluate((element) => element === document.activeElement),
      ).toBe(true);
      await palette.getByRole("combobox").fill("Oberflächengröße");
      await palette.getByRole("option", { name: /^Oberflächengröße Darstellung$/ }).waitFor();
      await page.keyboard.press("ArrowDown");
      const selected = palette.locator('[role="option"][aria-selected="true"]');
      expect(await selected.getAttribute("data-index")).toBe("1");
      expect(await selected.getAttribute("id")).toBe(
        await palette.getByRole("combobox").getAttribute("aria-activedescendant"),
      );
      await page.keyboard.press("Escape");
      await page.locator('[aria-label="Command palette"]').waitFor({ state: "detached" });
      expect(
        await history.evaluate((element) => element.getAttribute("data-state") === "open"),
      ).toBe(true);
      expect(await historyInput.evaluate((element) => element === document.activeElement)).toBe(
        true,
      );
      expect(
        await page.locator("[data-command-palette-home] > [data-command-palette-portal]").count(),
      ).toBe(1);
      await cdp?.send("HeapProfiler.collectGarbage");
      const heapBefore = (await cdp?.send("Runtime.getHeapUsage"))?.usedSize ?? null;
      const before = await appRequestSnapshot(page);
      let maxOptionNodes = 0;
      let maxHistoryRows = 0;
      for (let index = 0; index < 9; index++) {
        await page.keyboard.press(hotkey);
        await palette.locator('[role="option"]').first().waitFor();
        await page.waitForFunction(
          (count) =>
            (window as unknown as { historyPaletteDurations: number[] }).historyPaletteDurations
              .length === count,
          index + 2,
        );
        maxOptionNodes = Math.max(maxOptionNodes, await palette.locator('[role="option"]').count());
        maxHistoryRows = Math.max(
          maxHistoryRows,
          await history.locator('[data-slot="query-history-list"] [data-index]').count(),
        );
        expect(
          await palette
            .getByRole("combobox")
            .evaluate((element) => element === document.activeElement),
        ).toBe(true);
        expect(await history.locator("[data-command-palette-portal]").count()).toBe(1);
        await page.keyboard.press("Escape");
        await page.locator('[aria-label="Command palette"]').waitFor({ state: "detached" });
        expect(
          await history.evaluate((element) => element.getAttribute("data-state") === "open"),
        ).toBe(true);
        expect(await historyInput.evaluate((element) => element === document.activeElement)).toBe(
          true,
        );
      }
      const afterWarm = await appRequestSnapshot(page);
      await page.keyboard.press("Escape");
      await history.waitFor({ state: "detached" });
      expect(await tools.evaluate((element) => element === document.activeElement)).toBe(true);
      await page.waitForTimeout(300);
      const idle = requestsSince(afterWarm, await appRequestSnapshot(page));
      const warm = requestsSince(before, afterWarm);
      await cdp?.send("HeapProfiler.collectGarbage");
      const heapAfter = (await cdp?.send("Runtime.getHeapUsage"))?.usedSize ?? null;
      const retainedHeapGrowthBytes =
        heapAfter === null || heapBefore === null ? null : Math.max(0, heapAfter - heapBefore);
      const result = await page.evaluate(() => {
        const state = window as unknown as { historyPaletteDurations: number[] };
        return {
          coldMs: state.historyPaletteDurations[0],
          samples: state.historyPaletteDurations.slice(1),
          nodes: document.querySelectorAll("*").length,
          bodyHosts: document.querySelectorAll("body > [data-command-palette-home]").length,
          returnedHosts: document.querySelectorAll(
            "[data-command-palette-home] > [data-command-palette-portal]",
          ).length,
          paletteDialogs: document.querySelectorAll('[aria-label="Command palette"]').length,
          historyDialogs: document.querySelectorAll('[data-slot="query-history-dialog"]').length,
        };
      });
      const durations = interactionPercentiles(result.samples);
      await reportScenario(`palette-history-overlay-${engine}`, {
        browser: browser.version(),
        cpuRate: engine === "chromium" ? 4 : 1,
        historyModal: "scoped-radix-focus-scope",
        tables: 3000,
        historyEntries: 5000,
        savedQueries: 5000,
        ...result,
        ...durations,
        maxOptionNodes,
        maxHistoryRows,
        warm,
        idle,
        retainedHeapGrowthBytes,
        historyHitTestingPassed: true,
        comboboxFocused: true,
        keyboardSearchPassed: true,
        firstEscapeClosesPaletteOnly: true,
        secondEscapeClosesHistory: true,
        historySearchFocusRestored: true,
        hostReturnedHome: true,
      });
      expect(durations.runs).toBe(9);
      expect(result.coldMs).toBeLessThan(1000);
      expect(durations.p95Ms).toBeLessThan(120);
      expect(maxOptionNodes).toBeLessThanOrEqual(30);
      expect(maxHistoryRows).toBeLessThan(50);
      expect(result.nodes).toBeLessThan(6000);
      expect(result.bodyHosts).toBe(1);
      expect(result.returnedHosts).toBe(1);
      expect(result.paletteDialogs).toBe(0);
      expect(result.historyDialogs).toBe(0);
      expect(warm.databaseRequests).toBe(0);
      expect(idle.databaseRequests).toBe(0);
      if (retainedHeapGrowthBytes !== null)
        expect(retainedHeapGrowthBytes).toBeLessThan(16 * 1024 * 1024);
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
      server.stop(true);
    }
  },
  60000,
);
