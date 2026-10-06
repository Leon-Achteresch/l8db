import { expect, test } from "bun:test";
import { type Browser, chromium, type Page } from "playwright";
import { seedApp } from "./fixtures/perf-app";

const BASE_URL = process.env.L8DB_TABLE_JOURNEY_URL;
const ROWS = 5000;
const PAGE_SIZE = 500;
const COLUMNS = 30;
const COUNT_RENDERS = process.env.L8DB_TABLE_JOURNEY_TIMING !== "1";
const TRACE = process.env.L8DB_TABLE_JOURNEY_TRACE === "1";
const CPU_RATE = Number(process.env.L8DB_TABLE_JOURNEY_CPU ?? 1);

type Counts = Record<string, { mount: number; update: number }>;
type Window = {
  __journey: {
    reset: () => void;
    read: () => { commits: number; counts: Counts };
    enable: (on: boolean) => void;
    longTasks: { start: number; duration: number }[];
    shifts: { start: number; value: number; sources: string[] }[];
    events: { name: string; start: number; duration: number }[];
  };
};

async function instrument(page: Page) {
  await page.addInitScript(
    ({ total, pageSize }) => {
      const internals = (
        window as unknown as {
          __TAURI_INTERNALS__: {
            invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
          };
        }
      ).__TAURI_INTERNALS__;
      const original = internals.invoke;
      const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
      internals.invoke = async (command, args) => {
        const result = await original(command, args);
        if (command === "fetch_table_rows") {
          await wait(40);
          const data = result as { columns: string[]; rows: Record<string, unknown>[] };
          const offset = Number(args?.offset ?? 0);
          const limit = Number(args?.limit ?? pageSize);
          const desc = args?.orderBy !== undefined;
          const filter = String(args?.filter ?? "");
          const source = filter ? data.rows.filter((_, i) => i % 7 === 0) : data.rows;
          const rows = [];
          for (let i = offset; i < Math.min(source.length, offset + limit); i++)
            rows.push({ ...source[desc ? source.length - 1 - i : i] });
          return { columns: data.columns, rows };
        }
        if (command === "count_table_rows" || command === "count_table_rows_capped") {
          await wait(250);
          const count = args?.filter ? Math.ceil(total / 7) : total;
          return command === "count_table_rows" ? count : { count, exact: true, estimate: null };
        }
        return result;
      };

      const counts: Counts = {};
      let commits = 0;
      let enabled = false;
      const nameOf = (fiber: {
        tag: number;
        type: { displayName?: string; name?: string; render?: { name?: string } } | null;
      }) => {
        const type = fiber.type;
        if (!type) return null;
        if (fiber.tag === 11) return type.displayName || type.render?.name || null;
        return type.displayName || type.name || null;
      };
      type Fiber = {
        tag: number;
        flags: number;
        type: { displayName?: string; name?: string } | null;
        alternate: Fiber | null;
        child: Fiber | null;
        sibling: Fiber | null;
      };
      const walk = (fiber: Fiber) => {
        const stack = [fiber];
        while (stack.length) {
          const node = stack.pop()!;
          const previous = node.alternate;
          if (node.tag === 0 || node.tag === 1 || node.tag === 11 || node.tag === 15) {
            const mounted = previous === null;
            if (mounted || (node.flags & 1) === 1) {
              const name = nameOf(node);
              if (name) {
                counts[name] ??= { mount: 0, update: 0 };
                counts[name][mounted ? "mount" : "update"]++;
              }
            }
          }
          if (previous && previous.child === node.child) continue;
          for (let child = node.child; child; child = child.sibling) stack.push(child);
        }
      };
      const journey = {
        reset: () => {
          for (const key of Object.keys(counts)) delete counts[key];
          commits = 0;
        },
        read: () => ({ commits, counts: structuredClone(counts) }),
        enable: (on: boolean) => {
          enabled = on;
        },
        longTasks: [] as { start: number; duration: number }[],
        shifts: [] as { start: number; value: number; sources: string[] }[],
        events: [] as { name: string; start: number; duration: number }[],
      };
      Object.assign(window, { __journey: journey });
      Object.assign(window, {
        __REACT_DEVTOOLS_GLOBAL_HOOK__: {
          renderers: new Map(),
          supportsFiber: true,
          inject(renderer: unknown) {
            const id = this.renderers.size + 1;
            this.renderers.set(id, renderer);
            return id;
          },
          onScheduleFiberRoot() {},
          onCommitFiberUnmount() {},
          onPostCommitFiberRoot() {},
          checkDCE() {},
          onCommitFiberRoot(_id: number, root: { current: Fiber }) {
            commits++;
            if (enabled) walk(root.current);
          },
        },
      });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries())
          journey.longTasks.push({ start: entry.startTime, duration: entry.duration });
      }).observe({ type: "longtask", buffered: true });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as unknown as {
          startTime: number;
          value: number;
          sources: { node?: Node }[];
        }[])
          journey.shifts.push({
            start: entry.startTime,
            value: entry.value,
            sources: entry.sources.map((source) => {
              const node = source.node as HTMLElement | undefined;
              if (!node) return "?";
              if (node.closest?.("tr[aria-hidden]")) return "spacer";
              return `${node.nodeName}.${String(node.className ?? "").slice(0, 60)}`;
            }),
          });
      }).observe({ type: "layout-shift", buffered: true });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries())
          journey.events.push({
            name: entry.name,
            start: entry.startTime,
            duration: entry.duration,
          });
      }).observe({
        type: "event",
        durationThreshold: 16,
        buffered: true,
      } as PerformanceObserverInit);
    },
    { total: ROWS, pageSize: PAGE_SIZE },
  );
}

function since(page: Page, start: number) {
  return page.evaluate((start) => {
    const journey = (window as unknown as Window).__journey;
    return {
      longTasks: journey.longTasks.filter((task) => task.start >= start).map((t) => t.duration),
      shifts: journey.shifts.filter((shift) => shift.start >= start),
      events: journey.events.filter((event) => event.start >= start),
    };
  }, start);
}

const now = (page: Page) => page.evaluate(() => performance.now());
const settle = (page: Page, ms = 400) =>
  page.evaluate(
    (ms) =>
      new Promise((resolve) =>
        setTimeout(() => requestAnimationFrame(() => setTimeout(resolve)), ms),
      ),
    ms,
  );

type TraceEvent = { name: string; ph: string; dur?: number; tid: number; pid: number };

function summarizeTrace(buffer: Buffer) {
  const { traceEvents } = JSON.parse(buffer.toString()) as { traceEvents: TraceEvent[] };
  const totals: Record<string, { count: number; ms: number }> = {};
  for (const event of traceEvents) {
    if (event.ph !== "X" || event.dur === undefined) continue;
    totals[event.name] ??= { count: 0, ms: 0 };
    totals[event.name].count++;
    totals[event.name].ms += event.dur / 1000;
  }
  if (process.env.L8DB_TABLE_JOURNEY_VERBOSE)
    console.log(
      `  trace top: ${Object.entries(totals)
        .sort((a, b) => b[1].ms - a[1].ms)
        .slice(0, 14)
        .map(([name, total]) => `${name}:${total.count}/${total.ms.toFixed(1)}`)
        .join(" ")}`,
    );
  const pick = (name: string) => ({
    count: totals[name]?.count ?? 0,
    ms: Math.round((totals[name]?.ms ?? 0) * 10) / 10,
  });
  return {
    style: pick("UpdateLayoutTree"),
    layout: pick("Layout"),
    paint: pick("Paint"),
    prePaint: pick("PrePaint"),
    script: pick("FunctionCall"),
    hitTest: pick("HitTest"),
  };
}

async function track<T>(page: Page, label: string, run: () => Promise<T>, settleMs = 400) {
  const browser = page.context().browser() as Browser;
  if (TRACE)
    await browser.startTracing(page, {
      categories: ["devtools.timeline", "disabled-by-default-devtools.timeline.stack"],
    });
  const profiler =
    process.env.L8DB_TABLE_JOURNEY_PROFILE === label
      ? await page.context().newCDPSession(page)
      : null;
  if (profiler) {
    await profiler.send("Profiler.enable");
    await profiler.send("Profiler.setSamplingInterval", { interval: 100 });
    await profiler.send("Profiler.start");
  }
  await page.evaluate((on) => {
    const journey = (window as unknown as Window).__journey;
    journey.reset();
    journey.enable(on);
  }, COUNT_RENDERS);
  const start = await now(page);
  const value = await run();
  await settle(page, settleMs);
  const { commits, counts } = await page.evaluate(() => {
    const journey = (window as unknown as Window).__journey;
    journey.enable(false);
    return journey.read();
  });
  const perf = await since(page, start);
  const traceBuffer = TRACE ? await browser.stopTracing() : null;
  if (traceBuffer && process.env.L8DB_TABLE_JOURNEY_PROFILE === label)
    await Bun.write(`/tmp/l8db-journey/${label}.trace.json`, traceBuffer);
  const trace = traceBuffer ? summarizeTrace(traceBuffer) : null;
  if (profiler) {
    const { profile } = await profiler.send("Profiler.stop");
    await Bun.write(`/tmp/l8db-journey/${label}.cpuprofile`, JSON.stringify(profile));
  }
  const cells = counts.DataTableCell ?? { mount: 0, update: 0 };
  const rows = counts.DataTableRow ?? { mount: 0, update: 0 };
  const summary = {
    label,
    commits,
    cellRenders: cells.update,
    cellMounts: cells.mount,
    rowRenders: rows.update,
    rowMounts: rows.mount,
    worstEventMs: Math.max(0, ...perf.events.map((event) => event.duration)),
    longTasks: perf.longTasks.map((d) => Math.round(d)),
    shift: perf.shifts
      .filter((shift) => !shift.sources.every((source) => source === "spacer"))
      .reduce((sum, shift) => sum + shift.value, 0),
    trace,
  };
  const top = Object.entries(counts)
    .map(([name, count]) => [name, count.mount + count.update] as const)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([name, total]) => `${name}:${total}`)
    .join(" ");
  console.log(`journey ${JSON.stringify(summary)}\n  top: ${top}`);
  if (process.env.L8DB_TABLE_JOURNEY_VERBOSE)
    console.log(`  shifts: ${JSON.stringify(perf.shifts)}`);
  return { summary, value, perf };
}

test.skipIf(!BASE_URL)(
  "Tabelle öffnen, auswählen, sortieren, blättern und bearbeiten ohne unnötige Zell-Renders",
  async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await seedApp(page, 50, { rows: ROWS, columns: COLUMNS });
      await page.addInitScript((rowLimit) => {
        const saved = JSON.parse(localStorage.getItem("l8db.settings") ?? "{}");
        localStorage.setItem(
          "l8db.settings",
          JSON.stringify({ ...saved, state: { ...saved.state, rowLimit } }),
        );
      }, PAGE_SIZE);
      await instrument(page);
      await page.goto(`${BASE_URL}/`, { waitUntil: "commit", timeout: 120000 });
      await page.waitForSelector('a[data-name="table_0001"]', { timeout: 120000 });
      await settle(page, 1500);
      if (CPU_RATE > 1)
        await (await page.context().newCDPSession(page)).send("Emulation.setCPUThrottlingRate", {
          rate: CPU_RATE,
        });

      const openTable = async (name: string) =>
        page.evaluate(async (name) => {
          const link = document.querySelector<HTMLElement>(`a[data-name="${name}"]`)!;
          const old = new Set(document.querySelectorAll("tbody"));
          const start = performance.now();
          link.click();
          await new Promise<void>((resolve) => {
            const tick = () =>
              [...document.querySelectorAll('tbody tr[data-index="0"] td[data-col]')].some(
                (cell) => !old.has(cell.closest("tbody")!) && cell.checkVisibility(),
              )
                ? resolve()
                : requestAnimationFrame(tick);
            tick();
          });
          const inDom = performance.now() - start;
          await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve)));
          return { inDom, painted: performance.now() - start };
        }, name);

      const cold = await track(page, "open-cold", () => openTable("table_0000"), 0);
      console.log(`  open-cold ${JSON.stringify(cold.value)}`);
      await track(page, "after-open-cold", () => Promise.resolve(), 1500);
      const warm = await track(page, "open-warm", () => openTable("table_0001"), 0);
      console.log(`  open-warm ${JSON.stringify(warm.value)}`);
      const afterOpen = await track(page, "after-open-warm", () => Promise.resolve(), 1500);

      const cell = (row: number, column: string) =>
        page.locator(`tbody tr[data-index="${row}"] td[data-col="${column}"]`);

      await cell(3, "col_2").hover();
      const click = await track(page, "select-cell", () => cell(3, "col_2").click());
      const arrows = await track(page, "arrow-down-x10", async () => {
        for (let i = 0; i < 10; i++) await page.keyboard.press("ArrowDown");
      });
      const range = await track(page, "shift-click-range", () =>
        cell(8, "col_5").click({ modifiers: ["Shift"] }),
      );
      const clickAgain = await track(page, "select-cell-again", () => cell(1, "col_1").click());

      const scroll = await track(page, "scroll-60-frames", () =>
        page.evaluate(async () => {
          const scroller = document.querySelector<HTMLElement>("[data-grid-scroll]")!;
          const frames: number[] = [];
          let last = 0;
          await new Promise<void>((resolve) => {
            let n = 0;
            const step = (time: number) => {
              if (last) frames.push(time - last);
              last = time;
              scroller.scrollTop += 96;
              if (++n < 60) requestAnimationFrame(step);
              else resolve();
            };
            requestAnimationFrame(step);
          });
          scroller.scrollTop = 0;
          return Math.max(...frames);
        }),
      );
      console.log(`  scroll worst frame ${scroll.value.toFixed(1)} ms`);

      const editOpen = await track(page, "edit-open", async () => {
        await cell(2, "col_3").dblclick();
        await page.locator("tbody input").first().waitFor();
      });
      const edit = await track(page, "edit-type-10", async () => {
        for (const char of "abcdefghij") await page.keyboard.type(char);
      });
      await page.keyboard.press("Escape");
      await page
        .locator("[data-grid-scroll]")
        .first()
        .evaluate((element) => {
          element.scrollTop = 0;
          element.scrollLeft = 0;
        });
      await settle(page);

      const firstId = () => cell(0, "col_1").textContent();
      const before = await firstId();
      const sort = await track(
        page,
        "sort",
        async () => {
          await page.locator('thead th[data-column-id="col_1"] .flex-1 button').first().click();
          await page.waitForFunction(
            (before) =>
              document.querySelector('tbody tr[data-index="0"] td[data-col="col_1"]')
                ?.textContent !== before,
            before,
          );
        },
        800,
      );
      const afterSort = await firstId();
      const paging = await track(
        page,
        "next-page",
        async () => {
          await page.getByRole("button", { name: "Nächste Seite", exact: true }).click();
          await page.waitForFunction(
            (before) =>
              document.querySelector('tbody tr[data-index="0"] td[data-col="col_1"]')
                ?.textContent !== before,
            afterSort,
          );
        },
        800,
      );
      const search = await track(page, "grid-search-rows", async () => {
        await cell(1, "col_1").click();
        await page.keyboard.press("ControlOrMeta+f");
        await page.getByRole("button", { name: "Zeilen", exact: true }).click();
        for (const char of "value 1") await page.keyboard.type(char);
      });
      await page.keyboard.press("Escape");

      const results = {
        cold,
        warm,
        afterOpen,
        click,
        arrows,
        range,
        clickAgain,
        scroll,
        editOpen,
        edit,
        sort,
        paging,
        search,
      };
      for (const [name, { summary }] of Object.entries(results))
        console.log(`summary ${name}: ${JSON.stringify(summary)}`);
      expect(errors).toEqual([]);
      expect(warm.summary.shift).toBeLessThan(0.01);
      expect(afterOpen.summary.shift).toBeLessThan(0.01);
      if (COUNT_RENDERS) {
        expect(warm.summary.cellRenders + afterOpen.summary.cellRenders).toBe(0);
        expect(click.summary.cellRenders).toBeLessThanOrEqual(2);
        expect(click.summary.rowRenders).toBeLessThanOrEqual(2);
        expect(arrows.summary.cellRenders).toBeLessThanOrEqual(20);
        expect(arrows.summary.rowRenders).toBeLessThanOrEqual(20);
        expect(clickAgain.summary.cellRenders).toBeLessThan(40);
        expect(scroll.summary.cellRenders + scroll.summary.rowRenders).toBe(0);
        expect(edit.summary.cellRenders).toBeLessThanOrEqual(10);
        expect(edit.summary.rowRenders).toBeLessThanOrEqual(10);
        expect(search.summary.cellRenders).toBeLessThan(40);
      }
    } finally {
      await browser.close();
    }
  },
  180000,
);
