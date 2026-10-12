import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { type CDPSession, chromium, type Page, webkit } from "playwright";
import { reportScenario } from "../scripts/performance-report";
import { requestCounts } from "./fixtures/perf-app-requests";

interface GridControls {
  replace: ((generation: number, columns: number) => void) | null;
  unmount: () => void;
}

async function gridActivity(page: Page) {
  return page.evaluate(() => {
    const state = window as unknown as {
      gridFrames: { requested: number; pending: Set<number> };
      gridResizeTargets: number;
      gridInvocations: string[];
    };
    return {
      requested: state.gridFrames.requested,
      pending: state.gridFrames.pending.size,
      resizeTargets: state.gridResizeTargets,
      invocations: [...state.gridInvocations],
    };
  });
}

async function settleGrid(page: Page) {
  let previous = await gridActivity(page);
  let stableSince = performance.now();
  const started = stableSince;
  while (performance.now() - stableSince < 350) {
    if (performance.now() - started > 3000) throw new Error("Grid did not become idle");
    await page.waitForTimeout(50);
    const current = await gridActivity(page);
    if (current.pending || current.requested !== previous.requested)
      stableSince = performance.now();
    previous = current;
  }
}

async function detachedListeners(profiler: CDPSession | null) {
  if (!profiler || !process.env.L8DB_PERF_PROFILE) return null;
  const targets = await profiler.send("Runtime.evaluate", {
    expression:
      "window.gridCreatedTargets.flatMap(ref => { const node = ref.deref(); return node && !node.isConnected ? [node] : []; })",
    objectGroup: "grid-detached-listeners",
  });
  if (!targets.result.objectId) return [];
  const properties = await profiler.send("Runtime.getProperties", {
    objectId: targets.result.objectId,
    ownProperties: true,
  });
  const listeners: unknown[] = [];
  for (const property of properties.result) {
    const objectId = property.value?.objectId;
    if (!objectId || !/^\d+$/.test(property.name)) continue;
    const result = await profiler.send("DOMDebugger.getEventListeners", { objectId });
    if (result.listeners.length === 0) continue;
    const description = await profiler.send("Runtime.callFunctionOn", {
      objectId,
      functionDeclaration: "function() { return this.outerHTML.slice(0, 300); }",
      returnByValue: true,
    });
    listeners.push({
      target: description.result.value,
      types: result.listeners.map((listener) => listener.type),
    });
  }
  await profiler.send("Runtime.releaseObjectGroup", { objectGroup: "grid-detached-listeners" });
  return listeners;
}

async function replaceResult(page: Page, generation: number, columns: number) {
  return page.evaluate(
    ({ generation, columns }) =>
      new Promise<number>((resolve) => {
        const state = window as unknown as { gridLifecycle: GridControls };
        const root = document.getElementById("root");
        if (!root || !state.gridLifecycle.replace) throw new Error("Grid is not mounted");
        const started = performance.now();
        const observer = new MutationObserver(() => {
          const first = root.querySelector('tbody tr[data-index="0"] td[data-col="id"]');
          if (first?.textContent !== `${generation}:0`) return;
          observer.disconnect();
          requestAnimationFrame(() => resolve(performance.now() - started));
        });
        observer.observe(root, { childList: true, subtree: true, characterData: true });
        state.gridLifecycle.replace(generation, columns);
      }),
    { generation, columns },
  );
}

test.skipIf(!process.env.L8DB_PERF_BROWSER)(
  "grid result replacements retain bounded heap and release rows and observers after unmount",
  async () => {
    const bundle = await Bun.build({
      entrypoints: ["tests/fixtures/perf-grid-lifecycle.tsx"],
      plugins: [
        {
          name: "grid-alias",
          setup(build) {
            build.onResolve(
              { filter: /(?:^@tauri-apps\/api\/core$|(?:^|\/)core\.js$)/ },
              (args) => {
                if (
                  !args.path.startsWith("@tauri-apps/") &&
                  !args.resolveDir.replaceAll("\\", "/").includes("@tauri-apps/api")
                )
                  return;
                return {
                  path: Bun.resolveSync("@tauri-apps/api/core", import.meta.dir),
                  namespace: "browser-tauri",
                };
              },
            );
            build.onLoad({ filter: /.*/, namespace: "browser-tauri" }, async (args) => ({
              contents: await readFile(args.path, "utf8"),
              loader: "js",
            }));
            build.onResolve({ filter: /^@\/router$/ }, () => ({
              path: "router",
              namespace: "router-stub",
            }));
            build.onLoad({ filter: /.*/, namespace: "router-stub" }, () => ({
              contents: "export const router = null;",
              loader: "js",
            }));
            build.onResolve({ filter: /^@\// }, ({ path }) => ({
              path: Bun.resolveSync(
                resolve(import.meta.dir, "../src", path.slice(2)),
                import.meta.dir,
              ),
            }));
          },
        },
      ],
      target: "browser",
      format: "esm",
      minify: true,
      define: {
        "process.env.NODE_ENV": '"production"',
        "import.meta.env.DEV": "false",
        "import.meta.env.PROD": "true",
      },
    });
    if (!bundle.success) throw new Error(bundle.logs.map(String).join("\n"));
    const source = await bundle.outputs[0].text();
    const dist = resolve(process.env.L8DB_PERF_DIST ?? "dist");
    const html = await Bun.file(resolve(dist, "index.html")).text();
    const stylesheet = html.match(/rel="stylesheet"[^>]+href="([^"]+)"/)?.[1];
    if (!stylesheet) throw new Error("Production stylesheet is missing");
    const css = await Bun.file(resolve(dist, stylesheet.replace(/^\//, ""))).text();
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === "/fixture.js")
          return new Response(source, { headers: { "Content-Type": "text/javascript" } });
        if (path.startsWith("/assets/"))
          return new Response(Bun.file(resolve(dist, path.slice(1))));
        return new Response(
          `<!doctype html><html><head><meta charset="UTF-8"><base href="/assets/"><style>${css}html,body,#root{margin:0;height:100%}#root{height:600px}</style></head><body><button type="button" style="position:fixed;top:0;left:0;z-index:1000" onclick="window.gridLifecycle.unmount()">Grid schließen</button><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>`,
          { headers: { "Content-Type": "text/html" } },
        );
      },
    });
    const engine = process.env.L8DB_PERF_ENGINE === "webkit" ? "webkit" : "chromium";
    const browser = await (engine === "webkit" ? webkit : chromium).launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1200, height: 600 } });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.addInitScript(() => {
        const state = window as unknown as {
          gridFrames: { requested: number; pending: Set<number> };
          gridResizeTargets: number;
          gridInvocations: string[];
          __TAURI_INTERNALS__: { invoke: (command: string) => Promise<unknown> };
        };
        const request = window.requestAnimationFrame.bind(window);
        const cancel = window.cancelAnimationFrame.bind(window);
        state.gridFrames = { requested: 0, pending: new Set() };
        state.gridResizeTargets = 0;
        state.gridInvocations = [];
        state.__TAURI_INTERNALS__ = {
          invoke: async (command) => {
            state.gridInvocations.push(command);
            if (command === "mcp_config")
              return {
                enabled: false,
                maxRows: 50,
                maxCellChars: 200,
                maxChars: 20_000,
                queryTimeout: 30,
                redaction: { columns: [], values: [], replacement: "***" },
                connections: [],
                workflows: false,
              };
            throw new Error(`Unexpected grid request: ${command}`);
          },
        };
        window.requestAnimationFrame = (callback) => {
          state.gridFrames.requested++;
          const id = request((time) => {
            state.gridFrames.pending.delete(id);
            callback(time);
          });
          state.gridFrames.pending.add(id);
          return id;
        };
        window.cancelAnimationFrame = (id) => {
          state.gridFrames.pending.delete(id);
          cancel(id);
        };
        const NativeResizeObserver = window.ResizeObserver;
        window.ResizeObserver = class extends NativeResizeObserver {
          private targets = new Set<Element>();
          observe(target: Element, options?: ResizeObserverOptions) {
            super.observe(target, options);
            if (this.targets.has(target)) return;
            this.targets.add(target);
            state.gridResizeTargets++;
          }
          unobserve(target: Element) {
            super.unobserve(target);
            if (this.targets.delete(target)) state.gridResizeTargets--;
          }
          disconnect() {
            super.disconnect();
            state.gridResizeTargets -= this.targets.size;
            this.targets.clear();
          }
        };
      });
      if (process.env.L8DB_PERF_PROFILE)
        await page.addInitScript(() => {
          const targets: WeakRef<Element>[] = [];
          (window as unknown as { gridCreatedTargets: typeof targets }).gridCreatedTargets =
            targets;
          const createElement = document.createElement.bind(document);
          document.createElement = (tag, options) => {
            const element = createElement(tag, options);
            targets.push(new WeakRef(element));
            return element;
          };
        });
      await page.goto(`http://localhost:${server.port}/`);
      await page.waitForFunction(() =>
        Boolean((window as unknown as { gridLifecycle: GridControls }).gridLifecycle?.replace),
      );
      await page.evaluate(() => document.fonts.ready);
      const profiler = engine === "chromium" ? await page.context().newCDPSession(page) : null;
      const heap = async () => {
        if (!profiler) return null;
        await profiler.send("HeapProfiler.collectGarbage");
        return (await profiler.send("Runtime.getHeapUsage")).usedSize;
      };
      const emptyHeapBytes = await heap();
      const emptyCounters = (await profiler?.send("Memory.getDOMCounters")) ?? null;
      const emptyResizeTargets = await page.evaluate(
        () => (window as unknown as { gridResizeTargets: number }).gridResizeTargets,
      );
      await replaceResult(page, 0, 121);
      await replaceResult(page, 1, 121);
      await settleGrid(page);
      const heapBeforeBytes = await heap();
      const countersBefore = (await profiler?.send("Memory.getDOMCounters")) ?? null;
      const resizeTargetsBefore = await page.evaluate(
        () => (window as unknown as { gridResizeTargets: number }).gridResizeTargets,
      );
      const beforeDOM = await page.locator("*").count();
      const durations: number[] = [];
      let largestDOM = beforeDOM;
      let largestCells = 0;
      for (let index = 0; index < 12; index++) {
        const columns = [13, 50, 121][index % 3];
        if (index % 3 === 0) {
          await page.getByRole("button", { name: "Zeile 1 markieren", exact: true }).click();
          await page.getByRole("button", { name: "Filter", exact: true }).click();
          await page
            .getByRole("textbox", { name: "Filter für col_0", exact: true })
            .fill("__absent__");
          await page.waitForFunction(() => document.body.textContent?.includes("0 von "));
        }
        durations.push(await replaceResult(page, index + 2, columns));
        expect(await page.getByRole("textbox", { name: /^Filter für / }).count()).toBe(0);
        expect(
          await page
            .getByRole("button", { name: "Zeile 1 markieren", exact: true })
            .getAttribute("aria-pressed"),
        ).toBe("false");
        await page.locator(".overflow-auto").evaluate((element) => {
          element.scrollTop = 3000;
          element.scrollLeft = 1800;
        });
        await page.waitForTimeout(100);
        const renderedRows = await page.locator("tbody tr[data-index]").count();
        expect(renderedRows).toBeGreaterThan(0);
        expect(renderedRows).toBeLessThan(80);
        expect(
          await page.evaluate(() => {
            const box = document.querySelector(".overflow-auto")?.getBoundingClientRect();
            const header = document.querySelector("thead th")?.getBoundingClientRect();
            if (!box || !header) return false;
            return [header.bottom + 10, box.bottom - 20].every((y) =>
              [box.left + 80, box.right - 20].every((x) => {
                const cell = document.elementFromPoint(x, y)?.closest("td");
                return Boolean(
                  cell?.closest("tr[data-index]") && !cell.hasAttribute("aria-hidden"),
                );
              }),
            );
          }),
        ).toBe(true);
        largestCells = Math.max(
          largestCells,
          await page.locator("tbody td:not([aria-hidden])").count(),
        );
        largestDOM = Math.max(largestDOM, await page.locator("*").count());
        await page.locator(".overflow-auto").evaluate((element) => {
          element.scrollTop = 0;
          element.scrollLeft = 0;
        });
        await page.waitForFunction(() =>
          Boolean(document.querySelector('tbody tr[data-index="0"]')),
        );
      }
      await settleGrid(page);
      const heapAfterBytes = await heap();
      const countersAfter = (await profiler?.send("Memory.getDOMCounters")) ?? null;
      const resizeTargetsAfter = await page.evaluate(
        () => (window as unknown as { gridResizeTargets: number }).gridResizeTargets,
      );
      const afterDOM = await page.locator("*").count();
      const mountedIdleBefore = await gridActivity(page);
      await page.waitForTimeout(300);
      const mountedIdleAfter = await gridActivity(page);
      await page.getByRole("button", { name: "Filter", exact: true }).click();
      const focusedFilter = page.getByRole("textbox", { name: "Filter für col_0", exact: true });
      await focusedFilter.fill("__absent__");
      await expect(
        focusedFilter.evaluate((element) => element === document.activeElement),
      ).resolves.toBe(true);
      await page.getByRole("button", { name: "Grid schließen", exact: true }).click();
      await settleGrid(page);
      const unmountedHeapBytes = await heap();
      const unmountedCounters = (await profiler?.send("Memory.getDOMCounters")) ?? null;
      if (profiler && process.env.L8DB_PERF_PROFILE) {
        const chunks: string[] = [];
        const append = ({ chunk }: { chunk: string }) => chunks.push(chunk);
        profiler.on("HeapProfiler.addHeapSnapshotChunk", append);
        await profiler.send("HeapProfiler.takeHeapSnapshot");
        profiler.off("HeapProfiler.addHeapSnapshotChunk", append);
        await Bun.write(
          resolve(
            process.env.L8DB_PERF_REPORT_DIR ?? "/tmp",
            `grid-lifecycle-${engine}.heapsnapshot`,
          ),
          chunks.join(""),
        );
      }
      const unmountedDetachedListeners = await detachedListeners(profiler);
      const idleBefore = await gridActivity(page);
      await page.waitForTimeout(300);
      const idleAfter = await gridActivity(page);
      const samples = [...durations].sort((left, right) => left - right);
      const medianMs = samples[Math.floor(samples.length / 2)];
      const p95Ms = samples[Math.ceil(samples.length * 0.95) - 1];
      const retainedHeapGrowthBytes =
        heapBeforeBytes === null || heapAfterBytes === null
          ? null
          : heapAfterBytes - heapBeforeBytes;
      const unmountedHeapGrowthBytes =
        emptyHeapBytes === null || unmountedHeapBytes === null
          ? null
          : unmountedHeapBytes - emptyHeapBytes;
      const retainedDOMNodeGrowth =
        countersBefore && countersAfter ? countersAfter.nodes - countersBefore.nodes : null;
      await reportScenario(`grid-lifecycle-${engine}`, {
        engine,
        browser: browser.version(),
        rows: 5_000,
        columns: [13, 50, 121],
        replacements: 12,
        warmupReplacements: 2,
        unmountTrigger: "Visible close button clicked while a filter input is focused",
        medianMs,
        p95Ms,
        samples: durations,
        emptyHeapBytes,
        heapBeforeBytes,
        heapAfterBytes,
        unmountedHeapBytes,
        retainedHeapGrowthBytes,
        unmountedHeapGrowthBytes,
        heapScope: "Chromium renderer JavaScript heap after forced GC; unavailable in WebKit",
        retainedDOMNodeGrowth,
        domCounterScope: "Browser DOM counters after forced GC, including detached nodes",
        emptyCounters,
        countersBefore,
        countersAfter,
        unmountedCounters,
        unmountedDetachedListeners,
        beforeDOM,
        afterDOM,
        largestDOM,
        largestCells,
        mountedIdleBefore,
        mountedIdleAfter,
        idleBefore,
        idleAfter,
        emptyResizeTargets,
        resizeTargetsBefore,
        resizeTargetsAfter,
        requests: requestCounts(idleAfter.invocations),
        limits: {
          p95Ms: 1000,
          retainedHeapGrowthBytes: 16 * 1024 * 1024,
          unmountedHeapGrowthBytes: 8 * 1024 * 1024,
          retainedDOMNodeGrowth: 256,
          largestDOM: 4000,
          largestCells: 1200,
          idleFrameRequests: 0,
          idleResizeTargets: 0,
          databaseRequests: 0,
        },
        sourceHash: Bun.hash(source).toString(16),
        styleHash: Bun.hash(css).toString(16),
      });
      expect(errors).toEqual([]);
      expect(p95Ms).toBeLessThan(1000);
      expect(afterDOM - beforeDOM).toBeLessThan(128);
      expect(largestDOM).toBeLessThan(4000);
      expect(largestCells).toBeLessThan(1200);
      expect(resizeTargetsAfter).toBeLessThan(80);
      if (retainedHeapGrowthBytes !== null)
        expect(retainedHeapGrowthBytes).toBeLessThan(16 * 1024 * 1024);
      if (unmountedHeapGrowthBytes !== null)
        expect(unmountedHeapGrowthBytes).toBeLessThan(8 * 1024 * 1024);
      if (retainedDOMNodeGrowth !== null) expect(retainedDOMNodeGrowth).toBeLessThan(256);
      if (countersBefore && countersAfter)
        expect(countersAfter.jsEventListeners - countersBefore.jsEventListeners).toBeLessThan(16);
      if (emptyCounters && unmountedCounters)
        expect(unmountedCounters.nodes - emptyCounters.nodes).toBeLessThan(128);
      if (emptyCounters && unmountedCounters)
        expect(unmountedCounters.jsEventListeners - emptyCounters.jsEventListeners).toBeLessThan(
          16,
        );
      expect(await page.locator("#root > *").count()).toBe(0);
      expect(mountedIdleBefore.pending).toBe(0);
      expect(mountedIdleAfter.pending).toBe(0);
      expect(mountedIdleAfter.requested).toBe(mountedIdleBefore.requested);
      expect(idleBefore.pending).toBe(0);
      expect(idleAfter.pending).toBe(0);
      expect(idleAfter.requested).toBe(idleBefore.requested);
      expect(idleBefore.resizeTargets).toBe(emptyResizeTargets);
      expect(idleAfter.resizeTargets).toBe(emptyResizeTargets);
      expect(idleAfter.invocations).toEqual(["mcp_config"]);
    } finally {
      await browser.close();
      server.stop(true);
    }
  },
  60_000,
);
