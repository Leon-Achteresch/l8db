import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { type CDPSession, chromium, type Page } from "playwright";
import { seedApp } from "./fixtures/perf-app";

const STATEMENTS = 3000;
const RESULT_ROWS = 50000;
const CYCLES = 6;
const BURST = 8;

function serveDist() {
  return Bun.serve({
    port: 0,
    fetch: async (request) => {
      const pathname = new URL(request.url).pathname;
      const file = Bun.file(resolve("dist", pathname.replace(/^\//, "")));
      if (pathname !== "/" && (await file.exists())) return new Response(file);
      return new Response(Bun.file(resolve("dist", "index.html")), {
        headers: { "Content-Type": "text/html" },
      });
    },
  });
}

async function seedQueryTab(page: Page, sql: string) {
  await page.addInitScript((sql) => {
    localStorage.setItem(
      "l8db.table-tabs",
      JSON.stringify({
        version: 4,
        state: {
          tabsByConnection: {
            perf: [
              ...Array.from({ length: 11 }, (_, index) => ({
                kind: "table",
                schema: "public",
                table: `table_${String(index).padStart(4, "0")}`,
                entityType: "table",
              })),
              { kind: "query", id: "editor-perf", title: "P", sql },
            ],
          },
        },
      }),
    );
    localStorage.setItem(
      "l8db.query-workspace",
      JSON.stringify({ version: 0, state: { navigatorVisible: true, statusVisible: true } }),
    );
    type Fiber = Record<string, unknown> | null;
    const seen = new WeakMap<object, unknown[]>();
    const stats = { commits: 0, renders: 0, sizes: [] as number[] };
    const visit = (fiber: Fiber) => {
      for (let node = fiber; node; node = node.sibling as Fiber) {
        const tag = node.tag as number;
        if (tag === 0 || tag === 1 || tag === 11 || tag === 14 || tag === 15) {
          const key = (node.alternate as object | null) ?? node;
          const marker = [node.memoizedProps, node.memoizedState];
          const previous = seen.get(node) ?? seen.get(key);
          if (!previous || previous[0] !== marker[0] || previous[1] !== marker[1]) stats.renders++;
          seen.set(node, marker);
          seen.set(key, marker);
        }
        visit(node.child as Fiber);
      }
    };
    Object.assign(window, {
      __renderStats: stats,
      __REACT_DEVTOOLS_GLOBAL_HOOK__: {
        supportsFiber: true,
        renderers: new Map(),
        inject: () => 1,
        checkDCE: () => {},
        onScheduleFiberRoot: () => {},
        onCommitFiberUnmount: () => {},
        onPostCommitFiberRoot: () => {},
        onCommitFiberRoot: (_id: number, root: { current: Record<string, unknown> }) => {
          stats.commits++;
          if (!(window as unknown as { __countRenders?: boolean }).__countRenders) return;
          const previous = stats.renders;
          visit(root.current.child as Fiber);
          stats.sizes.push(stats.renders - previous);
        },
      },
    });
  }, sql);
}

async function metrics(cdp: CDPSession) {
  const { metrics } = (await cdp.send("Performance.getMetrics")) as {
    metrics: { name: string; value: number }[];
  };
  const value = (name: string) => metrics.find((metric) => metric.name === name)?.value ?? 0;
  return { task: value("TaskDuration") * 1000, heap: value("JSHeapUsedSize") / 1048576 };
}

async function observeLongTasks(page: Page) {
  await page.evaluate(() => {
    const durations: number[] = [];
    Object.assign(window, { __longTasks: durations });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) durations.push(entry.duration);
    }).observe({ type: "longtask" });
  });
}

const longTasks = (page: Page) =>
  page.evaluate(() => (window as unknown as { __longTasks: number[] }).__longTasks.splice(0));

const renderStats = (page: Page) =>
  page.evaluate(() => {
    const stats = (
      window as unknown as {
        __renderStats: { commits: number; renders: number; sizes: number[] };
      }
    ).__renderStats;
    const snapshot = { ...stats, sizes: stats.sizes.splice(0) };
    stats.commits = 0;
    stats.renders = 0;
    return snapshot;
  });

test.skipIf(!process.env.L8DB_PERF_APP)(
  "SQL-Editor: Tippen in langen Skripten und große Ergebnisse bleiben flüssig",
  async () => {
    const server = serveDist();
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await seedApp(page, 500, { rows: RESULT_ROWS, columns: 24 });
      const script = Array.from(
        { length: STATEMENTS },
        (_, index) => `SELECT id, col_1 FROM table_${String(index % 500).padStart(4, "0")};`,
      ).join("\n");
      await seedQueryTab(page, `SELECT 'perf wide' AS label;\n${script}\n`);
      await page.goto(`http://localhost:${server.port}/query/editor-perf`);
      await page.locator('.monaco-editor[role="code"]').waitFor();
      await page
        .getByRole("complementary", { name: "Query-Navigator" })
        .getByText(/\d+ \/ \d+ Tabellen/)
        .waitFor();
      await page.waitForTimeout(1000);
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Performance.enable");
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
      await observeLongTasks(page);
      const profile = async (name: string, action: () => Promise<void>) => {
        if (process.env.L8DB_PERF_PROFILE !== name) return action();
        await cdp.send("Profiler.enable");
        await cdp.send("Profiler.start");
        await action();
        const { profile } = (await cdp.send("Profiler.stop")) as { profile: unknown };
        await Bun.write(`/tmp/l8db-${name}.cpuprofile`, JSON.stringify(profile));
      };

      await cdp.send("HeapProfiler.collectGarbage");
      const runBefore = await metrics(cdp);
      await longTasks(page);
      let runMs = 0;
      await profile("run", async () => {
        const started = Date.now();
        await page.getByRole("button", { name: "Statement ausführen", exact: true }).click();
        await page.locator('tbody tr[data-index="0"]').waitFor({ timeout: 60000 });
        runMs = Date.now() - started;
        await page.waitForTimeout(1500);
      });
      await cdp.send("HeapProfiler.collectGarbage");
      const runAfter = await metrics(cdp);
      const runTasks = await longTasks(page);
      const run = {
        mainThread: runAfter.task - runBefore.task,
        longest: Math.max(0, ...runTasks),
        heap: runAfter.heap - runBefore.heap,
      };
      console.log(
        `perf editor result: ${runMs} ms bis Grid (${RESULT_ROWS} Zeilen x 24 Spalten), ${run.mainThread.toFixed(0)} ms Main-Thread, längster Task ${run.longest.toFixed(0)} ms, Heap +${run.heap.toFixed(1)} MB`,
      );

      await page.locator(".monaco-editor .view-lines").click();
      await page.waitForTimeout(800);
      const typeBurst = async () => {
        for (let index = 0; index < BURST; index++) {
          await page.keyboard.type(index === BURST - 1 ? " " : "x");
          await page.waitForTimeout(20);
        }
        await page.waitForTimeout(700);
      };
      await renderStats(page);
      await longTasks(page);
      const before = await metrics(cdp);
      await profile("typing", async () => {
        for (let cycle = 0; cycle < CYCLES; cycle++) await typeBurst();
      });
      const after = await metrics(cdp);
      const typingTasks = await longTasks(page);
      await renderStats(page);
      await page.evaluate(() => Object.assign(window, { __countRenders: true }));
      for (let cycle = 0; cycle < CYCLES; cycle++) await typeBurst();
      await page.evaluate(() => Object.assign(window, { __countRenders: false }));
      const renders = await renderStats(page);
      const position = await page.getByText(/^Ze \d+, Sp \d+$/).textContent();
      expect(Number(/Sp (\d+)/.exec(position ?? "")?.[1])).toBeGreaterThan(CYCLES * BURST * 2);
      const sizes = renders.sizes.slice(1).sort((a, b) => b - a);
      const typing = {
        perCycle: (after.task - before.task) / CYCLES,
        longest: Math.max(0, ...typingTasks),
        flushRenders: sizes[0] ?? 0,
        keyRenders: sizes[sizes.length - 1 - Math.floor(sizes.length / 4)] ?? 0,
      };
      console.log(
        `perf editor typing: ${typing.perCycle.toFixed(0)} ms Main-Thread je ${BURST} Tasten + Sync, längster Task ${typing.longest.toFixed(0)} ms, ${typing.flushRenders} Komponenten je SQL-Sync-Commit, ${typing.keyRenders} je Tasten-Commit, ${renders.commits} Commits für ${CYCLES * BURST} Tasten`,
      );

      expect(run.heap).toBeLessThan(10);
      expect(run.longest).toBeLessThan(350);
      expect(typing.flushRenders).toBeLessThanOrEqual(400);
      expect(typing.keyRenders).toBeLessThanOrEqual(2);
      expect(typing.longest).toBeLessThan(200);
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
  120000,
);
