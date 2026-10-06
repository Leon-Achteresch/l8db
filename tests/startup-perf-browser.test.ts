import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { type Browser, chromium } from "playwright";
import { seedApp } from "./fixtures/perf-app";

const ENABLED = Boolean(process.env.L8DB_STARTUP_PERF);
const DIST = process.env.L8DB_PERF_DIST ?? "dist";
const RATE = Number(process.env.L8DB_PERF_CPU_RATE ?? 4);
const RUNS = Number(process.env.L8DB_STARTUP_RUNS ?? 3);
const READY_BUDGET_MS = Number(process.env.L8DB_STARTUP_READY_MS ?? 2000);
const FRAME_BUDGET_MS = Number(process.env.L8DB_STARTUP_FRAME_MS ?? 50);
const SCRIPT_BUDGET_BYTES = Number(process.env.L8DB_STARTUP_SCRIPT_BYTES ?? 2_200_000);
const INVOKE_BUDGET = Number(process.env.L8DB_STARTUP_INVOKES ?? 40);

type Sample = {
  fcp: number;
  ready: number;
  firstViewWorst: number;
  afterReadyWorst: number;
  afterReadyTaskWorst: number;
  bootTaskTotal: number;
  scripts: number;
  scriptBytes: number;
  invokes: string[];
  largest: string[];
  commits: number;
  errors: string[];
};

type Metric = Exclude<keyof Sample, "invokes" | "largest" | "errors">;

type StartupWindow = {
  __startupFrames: Array<{ at: number; duration: number }>;
  __startupTasks: Array<{ at: number; duration: number }>;
  __startupInvokes: Array<{ at: number; command: string }>;
  __startupCommits: number[];
};

async function measure(browser: Browser, port: number): Promise<Sample> {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  try {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route(
      (url) => url.hostname !== "localhost",
      (route) => route.fulfill({ contentType: "text/html", body: "" }),
    );
    await seedApp(page, 3000, { rows: 2000, columns: 60 }, "perf-test");
    await page.addInitScript(() => {
      const state = window as unknown as StartupWindow & {
        __TAURI_INTERNALS__: { invoke: (command: string, ...rest: unknown[]) => unknown };
        __REACT_DEVTOOLS_GLOBAL_HOOK__: unknown;
      };
      state.__startupFrames = [];
      state.__startupTasks = [];
      state.__startupInvokes = [];
      state.__startupCommits = [];
      const invoke = state.__TAURI_INTERNALS__.invoke;
      state.__TAURI_INTERNALS__.invoke = (command, ...rest) => {
        state.__startupInvokes.push({ at: performance.now(), command });
        return invoke(command, ...rest);
      };
      state.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
        isDisabled: false,
        supportsFiber: true,
        renderers: new Map(),
        inject: () => 1,
        checkDCE: () => {},
        onScheduleFiberRoot: () => {},
        onCommitFiberRoot: () => state.__startupCommits.push(performance.now()),
        onCommitFiberUnmount: () => {},
        onPostCommitFiberRoot: () => {},
      };
      let last = 0;
      const tick = (now: number) => {
        if (last) state.__startupFrames.push({ at: now, duration: now - last });
        last = now;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries())
          state.__startupTasks.push({ at: entry.startTime, duration: entry.duration });
      }).observe({ type: "longtask", buffered: true });
    });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: RATE });
    await page.goto(`http://localhost:${port}/`);
    await page.waitForSelector('a[data-name="table_0000"]', { timeout: 60000 });
    const readyAt = await page.evaluate(() => performance.now());
    await page.waitForTimeout(4000);
    const sample = await page.evaluate((readyAt) => {
      const state = window as unknown as StartupWindow;
      const frames = state.__startupFrames.filter((frame) => frame.at >= readyAt);
      const tasks = state.__startupTasks.filter((task) => task.at >= readyAt);
      const scripts = performance
        .getEntriesByType("resource")
        .filter(
          (entry): entry is PerformanceResourceTiming =>
            entry.startTime < readyAt && new URL(entry.name).pathname.endsWith(".js"),
        );
      return {
        fcp: performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? Number.NaN,
        ready: readyAt,
        firstViewWorst: Math.max(
          0,
          ...state.__startupFrames
            .filter((frame) => frame.at < readyAt)
            .map((frame) => frame.duration),
        ),
        afterReadyWorst: Math.max(0, ...frames.map((frame) => frame.duration)),
        afterReadyTaskWorst: Math.max(0, ...tasks.map((task) => task.duration)),
        bootTaskTotal: state.__startupTasks
          .filter((task) => task.at < readyAt)
          .reduce((sum, task) => sum + task.duration, 0),
        scripts: scripts.length,
        scriptBytes: scripts.reduce((sum, entry) => sum + entry.decodedBodySize, 0),
        invokes: state.__startupInvokes
          .filter((call) => call.at < readyAt)
          .map((call) => call.command),
        largest: scripts
          .sort((a, b) => b.decodedBodySize - a.decodedBodySize)
          .map(
            (entry) =>
              `${new URL(entry.name).pathname.split("/").at(-1)} ${(entry.decodedBodySize / 1000).toFixed(0)} KB`,
          ),
        commits: state.__startupCommits.filter((at) => at < readyAt).length,
      };
    }, readyAt);
    return { ...sample, errors };
  } finally {
    await page.close();
  }
}

test.skipIf(!ENABLED)(
  "Start: erste nutzbare Ansicht und anschließende Framezeiten",
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
    const browser = await chromium.launch({ headless: true });
    try {
      const samples: Sample[] = [];
      for (let run = 0; run < RUNS; run++) samples.push(await measure(browser, server.port));
      const pick = (key: Metric) =>
        samples.map((sample) => sample[key]).sort((a, b) => a - b)[samples.length >> 1];
      const invokes = samples[0].invokes;
      const counts = new Map<string, number>();
      for (const command of invokes) counts.set(command, (counts.get(command) ?? 0) + 1);
      console.log(
        `startup-perf ${RATE}× (Median aus ${RUNS}): FCP ${pick("fcp").toFixed(0)} ms, nutzbar nach ${pick("ready").toFixed(0)} ms, Long-Tasks bis dahin ${pick("bootTaskTotal").toFixed(0)} ms, schlimmster Frame ${pick("firstViewWorst").toFixed(0)} ms, danach ${pick("afterReadyWorst").toFixed(0)} ms und längster Task ${pick("afterReadyTaskWorst").toFixed(0)} ms`,
      );
      console.log(
        `startup-perf bis nutzbar: ${(pick("scriptBytes") / 1_000_000).toFixed(2)} MB JS in ${pick("scripts")} Chunks, ${invokes.length} invoke()-Aufrufe, ${pick("commits")} React-Commits`,
      );
      console.log(
        `startup-perf invokes: ${[...counts].map(([command, count]) => `${command}×${count}`).join(", ")}`,
      );
      console.log(
        `startup-perf größte Chunks: ${samples[0].largest.slice(0, Number(process.env.L8DB_STARTUP_TOP ?? 8)).join(", ")}`,
      );
      expect(pick("ready")).toBeLessThanOrEqual(READY_BUDGET_MS);
      expect(pick("afterReadyWorst")).toBeLessThanOrEqual(FRAME_BUDGET_MS);
      expect(pick("afterReadyTaskWorst")).toBeLessThanOrEqual(FRAME_BUDGET_MS);
      expect(pick("scriptBytes")).toBeLessThanOrEqual(SCRIPT_BUDGET_BYTES);
      expect(invokes.length).toBeLessThanOrEqual(INVOKE_BUDGET);
      expect(samples.flatMap((sample) => sample.errors)).toEqual([]);
    } finally {
      await browser.close();
      server.stop(true);
    }
  },
  180000,
);
