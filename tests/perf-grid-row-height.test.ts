import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { chromium, type Page, webkit } from "playwright";
import { reportScenario } from "../scripts/performance-report";
import { seedApp } from "./fixtures/perf-app";
import { interactionPercentiles } from "./fixtures/perf-app-interactions";
import {
  appRequestSnapshot,
  installAppRequestProbe,
  requestsSince,
} from "./fixtures/perf-app-requests";
import { profileWebKit } from "./fixtures/perf-webkit-profile";

const engines = process.env.L8DB_PERF_ENGINE
  ? [process.env.L8DB_PERF_ENGINE === "webkit" ? webkit : chromium]
  : [chromium, webkit];

async function rowObservers(page: Page) {
  return page.evaluate(() => {
    const state = window as unknown as {
      gridRowObservers: { targets: Set<Element>; largest: number; deliveries: number };
    };
    return {
      targets: state.gridRowObservers.targets.size,
      largest: state.gridRowObservers.largest,
      deliveries: state.gridRowObservers.deliveries,
    };
  });
}

async function measureScroll(page: Page, fraction: number) {
  return page.locator("tbody").evaluate(
    (element, value) =>
      new Promise<{ durationMs: number; renderedRows: number; renderedCells: number }>(
        (resolve, reject) => {
          let scroller = element.parentElement;
          while (scroller && getComputedStyle(scroller).overflowY !== "auto")
            scroller = scroller.parentElement;
          if (!scroller) throw new Error("Kein Scroll-Container gefunden.");
          const container = scroller;
          const target = (container.scrollHeight - container.clientHeight) * value;
          const box = container.getBoundingClientRect();
          const started = performance.now();
          let frame = 0;
          const timeout = setTimeout(() => {
            cancelAnimationFrame(frame);
            reject(new Error("Grid scroll did not cover the viewport"));
          }, 1500);
          const ready = () => {
            const covered = [box.top + box.height * 0.4, box.top + box.height * 0.8].every((y) => {
              const cell = document.elementFromPoint(box.left + box.width * 0.5, y)?.closest("td");
              return Boolean(cell?.closest("tr[data-index]") && !cell.hasAttribute("aria-hidden"));
            });
            if (!covered) {
              frame = requestAnimationFrame(ready);
              return;
            }
            frame = requestAnimationFrame(() => {
              clearTimeout(timeout);
              resolve({
                durationMs: performance.now() - started,
                renderedRows: element.querySelectorAll("tr[data-index]").length,
                renderedCells: element.querySelectorAll("td:not([aria-hidden])").length,
              });
            });
          };
          container.scrollTop = target;
          frame = requestAnimationFrame(ready);
        },
      ),
    fraction,
  );
}

for (const engine of engines) {
  test.skipIf(!process.env.L8DB_PERF_APP)(
    `${engine.name()}: Tabellenzeilen bleiben bei Dichte und Skalierung lückenlos`,
    async () => {
      const dist = resolve(process.env.L8DB_PERF_DIST ?? "dist");
      const server = Bun.serve({
        port: 0,
        fetch: async (request) => {
          const pathname = new URL(request.url).pathname;
          const file = Bun.file(resolve(dist, pathname.replace(/^\//, "")));
          return new Response(
            pathname !== "/" && (await file.exists())
              ? file
              : Bun.file(resolve(dist, "index.html")),
          );
        },
      });
      const browser = await engine.launch({ headless: true });
      try {
        const latencies: number[] = [];
        for (const { scale, density } of [
          { scale: 80, density: "compact" },
          { scale: 100, density: "normal" },
          { scale: 150, density: "spacious" },
        ]) {
          const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
          const errors: string[] = [];
          page.on("pageerror", (error) => errors.push(error.message));
          await seedApp(page, 100, { rows: 1000, columns: 60 });
          await installAppRequestProbe(page);
          await page.addInitScript(() => {
            const state = window as unknown as {
              gridRowObservers: { targets: Set<Element>; largest: number; deliveries: number };
            };
            state.gridRowObservers = { targets: new Set(), largest: 0, deliveries: 0 };
            const NativeResizeObserver = window.ResizeObserver;
            window.ResizeObserver = class extends NativeResizeObserver {
              private rows = new Set<Element>();
              constructor(callback: ResizeObserverCallback) {
                super((entries, observer) => {
                  if (entries.some((entry) => entry.target instanceof HTMLTableRowElement))
                    state.gridRowObservers.deliveries++;
                  callback(entries, observer);
                });
              }
              observe(target: Element, options?: ResizeObserverOptions) {
                super.observe(target, options);
                if (!(target instanceof HTMLTableRowElement) || this.rows.has(target)) return;
                this.rows.add(target);
                state.gridRowObservers.targets.add(target);
                state.gridRowObservers.largest = Math.max(
                  state.gridRowObservers.largest,
                  state.gridRowObservers.targets.size,
                );
              }
              unobserve(target: Element) {
                super.unobserve(target);
                this.rows.delete(target);
                state.gridRowObservers.targets.delete(target);
              }
              disconnect() {
                super.disconnect();
                for (const target of this.rows) state.gridRowObservers.targets.delete(target);
                this.rows.clear();
              }
            };
          });
          await page.addInitScript(
            ({ scale, density }) => {
              const saved = JSON.parse(localStorage.getItem("l8db.settings") ?? "{}");
              localStorage.setItem(
                "l8db.settings",
                JSON.stringify({
                  ...saved,
                  state: { ...saved.state, uiScale: scale, uiDensity: density, rowLimit: 1000 },
                }),
              );
            },
            { scale, density },
          );
          await page.goto(`http://localhost:${server.port}/tables/public/table_0000`);
          const first = page.locator('tbody tr[data-index="0"]');
          await first.waitFor();
          await page.evaluate(() => document.fonts.ready);
          const expected =
            ((density === "compact" ? 24 : density === "spacious" ? 40 : 32) * scale) / 100 + 1;
          const height = (await first.boundingBox())?.height ?? 0;
          expect(Math.abs(height - expected)).toBeLessThan(1);
          await page.waitForTimeout(300);
          expect((await rowObservers(page)).targets).toBe(1);
          const stopProfile =
            process.env.L8DB_PERF_PROFILE && engine.name() === "webkit"
              ? await profileWebKit(
                  page,
                  resolve(
                    process.env.L8DB_PERF_REPORT_DIR ?? "/tmp",
                    `grid-row-height-webkit-${scale}-${density}.profile.json`,
                  ),
                )
              : null;
          const editingRequestsBefore = await appRequestSnapshot(page);
          let editingHeight: number | null = null;
          if (density === "normal") {
            await first.locator('td[data-col="col_1"]').dblclick();
            await page.locator("tbody input, tbody select").first().waitFor();
            editingHeight = (await first.boundingBox())?.height ?? 0;
            expect(editingHeight).toBeGreaterThan(height + 10);
            expect((await rowObservers(page)).targets).toBeLessThanOrEqual(2);
            await page.keyboard.press("Escape");
            await page.locator("tbody input, tbody select").first().waitFor({ state: "hidden" });
            expect(Math.abs(((await first.boundingBox())?.height ?? 0) - height)).toBeLessThan(1);
            expect((await rowObservers(page)).targets).toBe(1);
          }
          const editingRequests = requestsSince(
            editingRequestsBefore,
            await appRequestSnapshot(page),
          );
          if (density === "normal") {
            expect(editingRequests.database).toEqual({
              list_constraints: 1,
              column_value_options: 1,
            });
            expect(editingRequests.databaseRequests).toBe(2);
          } else expect(editingRequests.databaseRequests).toBe(0);
          expect(editingRequests.unknownRequests).toBe(0);
          const requestsBefore = await appRequestSnapshot(page);
          if (density === "normal") {
            await first.locator('td[data-col="col_1"]').dblclick();
            await page.locator("tbody input, tbody select").first().waitFor();
            await page.keyboard.press("Escape");
            await page.locator("tbody input, tbody select").first().waitFor({ state: "hidden" });
          }
          await measureScroll(page, 0.03);
          await measureScroll(page, 0.05);
          const samples = [];
          for (const fraction of [0.25, 0.5, 1, 0, 0.75, 0.1, 0.9, 0.5, 1]) {
            const sample = await measureScroll(page, fraction);
            expect(sample.renderedRows).toBeGreaterThan(0);
            expect(sample.renderedRows).toBeLessThan(80);
            expect(sample.renderedCells).toBeLessThan(1200);
            samples.push(sample);
          }
          await page.locator('tbody tr[data-index="999"]').waitFor();
          const fontReflows = [];
          for (const fontSize of [10, 20]) {
            await measureScroll(page, 0);
            const style = await page.addStyleTag({
              content: `tbody td{font-size:${(fontSize * scale) / 100}px!important;line-height:${((fontSize + 8) * scale) / 100}px!important}`,
            });
            await page.waitForTimeout(200);
            const rowHeight = (await first.boundingBox())?.height ?? 0;
            const sample = await measureScroll(page, 1);
            await page.locator('tbody tr[data-index="999"]').waitFor();
            fontReflows.push({ fontSize, rowHeight, ...sample });
            expect(sample.renderedRows).toBeLessThan(80);
            expect(sample.renderedCells).toBeLessThan(1200);
            await style.evaluate((element) => element.remove());
            await style.dispose();
            await page.waitForTimeout(200);
          }
          const requestsAfter = await appRequestSnapshot(page);
          await page.waitForTimeout(300);
          const idleObserversBefore = await rowObservers(page);
          await page.waitForTimeout(300);
          const idleObserversAfter = await rowObservers(page);
          const idleRequests = requestsSince(requestsAfter, await appRequestSnapshot(page));
          const warmRequests = requestsSince(requestsBefore, requestsAfter);
          const timing = interactionPercentiles(samples.map((sample) => sample.durationMs));
          latencies.push(timing.p95Ms, ...fontReflows.map((sample) => sample.durationMs));
          await page.getByRole("link", { name: /^Einstellungen/ }).click();
          await page.waitForFunction(
            () =>
              (window as unknown as { gridRowObservers: { targets: Set<Element> } })
                .gridRowObservers.targets.size === 0,
          );
          await page.waitForTimeout(200);
          const unmountedObservers = await rowObservers(page);
          await stopProfile?.();
          await reportScenario(`grid-row-height-${engine.name()}-${scale}-${density}`, {
            engine: engine.name(),
            browser: browser.version(),
            profilingEnabled: Boolean(stopProfile),
            rows: 1000,
            columns: 60,
            scale,
            density,
            warmupScrolls: 2,
            rowHeight: height,
            editingHeight,
            editingRequests,
            fontReflows,
            ...timing,
            largestRenderedRows: Math.max(...samples.map((sample) => sample.renderedRows)),
            largestRenderedCells: Math.max(...samples.map((sample) => sample.renderedCells)),
            warmRequests,
            idleRequests,
            maxDatabaseConcurrency: requestsAfter.maxDatabaseConcurrency,
            idleObserversBefore,
            idleObserversAfter,
            unmountedObservers,
            limits: {
              p95Ms: 120,
              renderedRows: 80,
              renderedCells: 1200,
              databaseRequests: 0,
              normalRowObservers: 1,
              editingRowObservers: 2,
              unmountedRowObservers: 0,
              idleObserverDeliveries: 0,
            },
          });
          expect(warmRequests.databaseRequests).toBe(0);
          expect(idleRequests.databaseRequests).toBe(0);
          expect(warmRequests.unknownRequests).toBe(0);
          expect(idleRequests.unknownRequests).toBe(0);
          expect(idleObserversAfter.targets).toBe(1);
          expect(idleObserversAfter.deliveries).toBe(idleObserversBefore.deliveries);
          expect(unmountedObservers.targets).toBe(0);
          expect(unmountedObservers.largest).toBeLessThanOrEqual(2);
          expect(
            errors.filter(
              (error) => error !== "ResizeObserver loop completed with undelivered notifications.",
            ),
          ).toEqual([]);
          await page.close();
        }
        for (const latency of latencies) expect(latency).toBeLessThan(120);
      } finally {
        await browser.close();
        server.stop(true);
      }
    },
    60000,
  );
}
