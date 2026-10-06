import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { chromium, webkit } from "playwright";
import { POSTGRES_CAPABILITIES } from "../src/lib/providers";
import { seedApp } from "./fixtures/perf-app";

const ENABLED = Boolean(process.env.L8DB_SIDEBAR_PERF);
const WEBKIT = process.env.L8DB_SIDEBAR_PERF === "webkit";
const DIST = process.env.L8DB_PERF_DIST ?? "dist";
const RATE = Number(process.env.L8DB_PERF_CPU_RATE ?? 4);
const PACKAGES = Number(process.env.L8DB_SIDEBAR_PACKAGES ?? 1500);
const ROUNDS = Number(process.env.L8DB_SIDEBAR_ROUNDS ?? 6);
const ACTIVE_BUDGET_MS = Number(process.env.L8DB_SIDEBAR_ACTIVE_MS ?? 32);
const PAINT_BUDGET_MS = Number(process.env.L8DB_SIDEBAR_PAINT_MS ?? 80);
const FRAME_BUDGET_MS = Number(process.env.L8DB_SIDEBAR_FRAME_MS ?? 34);
const STYLE_BUDGET = Number(process.env.L8DB_SIDEBAR_STYLE_RECALCS ?? 32);
const ROW_BUDGET = 40;

type Switch = {
  activeMs: number;
  paintMs: number;
  commits: number;
  worstTaskMs: number;
  longTasks: number;
  droppedFrames: number;
  worstFrameMs: number;
  layouts: number;
  styleRecalcs: number;
  scriptMs: number;
  rows: number;
  covered: number;
};

test.skipIf(!ENABLED)(
  "Sidebar: Packages-Tab öffnet ohne Ruckler",
  async () => {
    if (!(await Bun.file(`${DIST}/index.html`).exists()))
      throw new Error(`${DIST} fehlt – vor dem Perf-Test 'bun run build' ausführen.`);
    const server = Bun.serve({
      port: 0,
      fetch: async (request) => {
        const pathname = new URL(request.url).pathname;
        const file = Bun.file(resolve(DIST, pathname.replace(/^\//, "")));
        if (pathname !== "/" && (await file.exists())) return new Response(file);
        return new Response(Bun.file(`${DIST}/index.html`), {
          headers: { "Content-Type": "text/html" },
        });
      },
    });
    const browser = await (WEBKIT ? webkit : chromium).launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route(
        (url) => url.hostname !== "localhost",
        (route) => route.fulfill({ contentType: "text/html", body: "" }),
      );
      await seedApp(page, 200, { rows: 20, columns: 6 });
      await page.addInitScript(
        ({ capabilities, packages }) => {
          const internals = (window as unknown as { __TAURI_INTERNALS__: Record<string, unknown> })
            .__TAURI_INTERNALS__;
          const base = internals.invoke as (command: string, args?: unknown) => Promise<unknown>;
          const delay = (ms: number) => new Promise((done) => setTimeout(done, ms));
          const routines = [
            ...Array.from({ length: packages }, (_, i) => ({
              schema: "APP",
              name: `PKG_${String(i).padStart(4, "0")}`,
              identity_args: "",
              return_type: "PACKAGE",
              language: "PLSQL",
              oid: `APP.PKG_${String(i).padStart(4, "0")}`,
            })),
            ...Array.from({ length: 400 }, (_, i) => ({
              schema: "APP",
              name: `FN_${String(i).padStart(4, "0")}`,
              identity_args: "P_ID NUMBER",
              return_type: "NUMBER",
              language: "PLSQL",
              oid: `APP.FN_${String(i).padStart(4, "0")}`,
            })),
          ];
          internals.invoke = async (command: string, args?: unknown) => {
            switch (command) {
              case "list_providers":
                return [
                  {
                    id: "oracle",
                    name: "Oracle",
                    group: "Enterprise",
                    kind: "oracle",
                    default_port: 1521,
                    file_based: false,
                    url_schemes: ["oracle"],
                    placeholder: "",
                    hint: "",
                    hosts: [],
                    driver: { type: "builtin" },
                    capabilities,
                    driver_status: {
                      available: true,
                      detail: "",
                      install: [],
                      install_command: null,
                    },
                  },
                ];
              case "list_functions":
                await delay(200);
                return routines;
              case "list_invalid_objects":
              case "list_compile_errors":
                await delay(150);
                return [];
              case "get_function_definition":
                await delay(100);
                return "PACKAGE x AS\n  PROCEDURE a;\nEND;";
              default:
                return base(command, args);
            }
          };
          const state = window as unknown as {
            __commits: number;
            __frames: number[];
            __tasks: Array<{ at: number; duration: number }>;
          };
          state.__commits = 0;
          state.__frames = [];
          state.__tasks = [];
          Object.assign(window, {
            __REACT_DEVTOOLS_GLOBAL_HOOK__: {
              supportsFiber: true,
              isDisabled: false,
              renderers: new Map(),
              inject: () => 1,
              checkDCE: () => {},
              onScheduleFiberRoot: () => {},
              onCommitFiberRoot: () => {
                state.__commits++;
              },
              onCommitFiberUnmount: () => {},
              onPostCommitFiberRoot: () => {},
            },
          });
          const tick = (now: number) => {
            state.__frames.push(now);
            requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
          if (PerformanceObserver.supportedEntryTypes.includes("longtask"))
            new PerformanceObserver((list) => {
              for (const entry of list.getEntries())
                state.__tasks.push({ at: entry.startTime, duration: entry.duration });
            }).observe({ type: "longtask", buffered: true });
        },
        {
          capabilities: {
            ...POSTGRES_CAPABILITIES,
            extensions: false,
            synonyms: true,
            materialized_views: false,
          },
          packages: PACKAGES,
        },
      );
      await page.addInitScript(() => {
        const raw = localStorage.getItem("l8db.connections");
        if (!raw) return;
        const parsed = JSON.parse(raw);
        parsed.state.connections[0].kind = "oracle";
        parsed.state.connections[0].connectionString = "oracle://app@localhost:1521/FREEPDB1";
        localStorage.setItem("l8db.connections", JSON.stringify(parsed));
        localStorage.setItem(
          "l8db.db-selection",
          JSON.stringify({ state: { database: "FREEPDB1", schema: "APP" }, version: 0 }),
        );
      });
      const cdp = WEBKIT ? null : await page.context().newCDPSession(page);
      await cdp?.send("Performance.enable");
      await page.goto(`http://localhost:${server.port}/`);
      const packagesTab = page.locator('[data-slot="tabs-trigger"][aria-label="Packages"]');
      const tablesTab = page.locator('[data-slot="tabs-trigger"][aria-label="Tabellen"]');
      await packagesTab.waitFor({ timeout: 30000 });
      await page.waitForTimeout(1500);
      await cdp?.send("Emulation.setCPUThrottlingRate", { rate: RATE });

      const metrics = async (): Promise<Record<string, number>> => {
        if (!cdp) return { LayoutCount: 0, RecalcStyleCount: 0, ScriptDuration: 0 };
        const { metrics } = await cdp.send("Performance.getMetrics");
        return Object.fromEntries(metrics.map((metric) => [metric.name, metric.value]));
      };

      const measure = async (): Promise<Switch> => {
        const before = await metrics();
        const box = await packagesTab.boundingBox();
        if (!box) throw new Error("Packages-Tab nicht sichtbar");
        await page.evaluate(() => {
          const state = window as unknown as {
            __probe: {
              start: number;
              active: number;
              painted: number;
              commits: number;
              rows: number;
              covered: number;
            };
            __commits: number;
          };
          state.__probe = {
            start: 0,
            active: 0,
            painted: 0,
            commits: state.__commits,
            rows: 0,
            covered: 0,
          };
          const probe = state.__probe;
          document.addEventListener(
            "pointerdown",
            (event) => {
              probe.start = event.timeStamp;
            },
            { capture: true, once: true },
          );
          const tab = document.querySelector('[data-slot="tabs-trigger"][aria-label="Packages"]');
          const poll = (now: number) => {
            if (probe.start) {
              if (!probe.active && tab?.getAttribute("data-state") === "active") probe.active = now;
              const first = [...document.querySelectorAll('[data-sidebar="menu-button"]')].find(
                (element) => element.textContent === "PKG_0000",
              );
              const list = first?.closest("ul");
              const scroller = first?.closest("[data-slot=sidebar-content]");
              if (list?.lastElementChild && scroller) {
                probe.painted = now;
                probe.rows = list.children.length;
                probe.covered = Number(
                  list.lastElementChild.getBoundingClientRect().bottom >=
                    scroller.getBoundingClientRect().bottom,
                );
              }
            }
            if (!probe.painted) requestAnimationFrame(poll);
          };
          requestAnimationFrame(poll);
        });
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await page.waitForFunction(
          () => (window as unknown as { __probe: { painted: number } }).__probe.painted > 0,
          undefined,
          { timeout: 10000 },
        );
        await page.waitForTimeout(1500);
        const after = await metrics();
        const result = await page.evaluate(() => {
          const state = window as unknown as {
            __probe: {
              start: number;
              active: number;
              painted: number;
              commits: number;
              rows: number;
              covered: number;
            };
            __commits: number;
            __frames: number[];
            __tasks: Array<{ at: number; duration: number }>;
          };
          const { start, active, painted, commits, rows, covered } = state.__probe;
          const end = start + 1500;
          const frames = state.__frames.filter((at) => at >= start && at <= end);
          const gaps = frames.slice(1).map((at, index) => at - frames[index]);
          const tasks = state.__tasks.filter((task) => task.at + task.duration >= start);
          return {
            activeMs: active - start,
            paintMs: painted - start,
            commits: state.__commits - commits,
            worstTaskMs: Math.max(0, ...tasks.map((task) => task.duration)),
            longTasks: tasks.length,
            droppedFrames: gaps.reduce(
              (sum, gap) => sum + Math.max(0, Math.round(gap / 16.7) - 1),
              0,
            ),
            worstFrameMs: Math.max(0, ...gaps),
            rows,
            covered,
          };
        });
        await tablesTab.click();
        await page.waitForTimeout(800);
        return {
          ...result,
          layouts: after.LayoutCount - before.LayoutCount,
          styleRecalcs: after.RecalcStyleCount - before.RecalcStyleCount,
          scriptMs: (after.ScriptDuration - before.ScriptDuration) * 1000,
        };
      };

      const runs: Switch[] = [];
      for (let round = 0; round < ROUNDS; round++) runs.push(await measure());
      const report = (label: string, run: Switch) =>
        console.log(
          `sidebar-packages ${WEBKIT ? "webkit" : `${RATE}×`} ${label}: aktiv ${run.activeMs.toFixed(0)} ms, Liste ${run.paintMs.toFixed(0)} ms, Commits ${run.commits}, längster Task ${run.worstTaskMs.toFixed(0)} ms (${run.longTasks} Long Tasks), ${run.droppedFrames} verlorene Frames (schlimmster ${run.worstFrameMs.toFixed(0)} ms), Layouts ${run.layouts}, Style-Recalcs ${run.styleRecalcs}, Script ${run.scriptMs.toFixed(0)} ms, ${run.rows} Zeilen`,
        );
      for (const [index, run] of runs.entries()) report(`#${index + 1}`, run);
      const warm = runs.slice(1);
      const median = Object.fromEntries(
        Object.keys(warm[0]).map((key) => {
          const values = warm.map((run) => run[key as keyof Switch]).sort((a, b) => a - b);
          return [key, values[Math.floor(values.length / 2)]];
        }),
      ) as Switch;
      report("Median", median);
      expect(median.activeMs).toBeLessThanOrEqual(ACTIVE_BUDGET_MS);
      expect(median.paintMs).toBeLessThanOrEqual(PAINT_BUDGET_MS);
      expect(median.worstFrameMs).toBeLessThanOrEqual(FRAME_BUDGET_MS);
      if (!WEBKIT) expect(median.styleRecalcs).toBeLessThanOrEqual(STYLE_BUDGET);
      for (const run of runs) {
        expect(run.rows).toBeLessThanOrEqual(ROW_BUDGET);
        expect(run.covered).toBe(1);
      }

      await cdp?.send("Emulation.setCPUThrottlingRate", { rate: 1 });
      await packagesTab.click();
      const row = (name: string) =>
        page.locator('[data-sidebar="menu-button"]').filter({ hasText: new RegExp(`^${name}$`) });
      await row("PKG_0000").click({ button: "right" });
      await page.getByRole("menuitem", { name: "Spec öffnen" }).waitFor({ timeout: 2000 });
      expect(await row("PKG_0000").getAttribute("data-state")).toBe("open");
      await page.keyboard.press("Escape");
      await page.getByRole("menu").waitFor({ state: "detached", timeout: 2000 });
      await row("PKG_0000").click({ button: "right" });
      await page.getByRole("menuitem", { name: "Spec öffnen" }).waitFor({ timeout: 2000 });
      await page.keyboard.press("Escape");
      await page.getByRole("menu").waitFor({ state: "detached", timeout: 2000 });
      await row("PKG_0001").click({ button: "right" });
      await page.getByRole("menuitem", { name: "Package löschen" }).click({ timeout: 2000 });
      await page.getByRole("alertdialog").getByText('Package "PKG_0001" löschen?').waitFor();
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
      server.stop(true);
    }
  },
  180000,
);
