import { afterEach, expect, test } from "bun:test";
import { measureScenario, reportScenario } from "../scripts/performance-report";
import { attachScrollEdgeFade } from "../src/features/table/data-table/use-scroll-edge-fade";

const COLUMNS = 400;
const COLUMN_WIDTH = 160;
const SCROLL_EVENTS = 20_000;

const RealResizeObserver = globalThis.ResizeObserver;
const observers: { callback: () => void; targets: number; disconnected: boolean }[] = [];

class FakeResizeObserver {
  entry: (typeof observers)[number];
  constructor(callback: () => void) {
    this.entry = { callback, targets: 0, disconnected: false };
    observers.push(this.entry);
  }
  observe() {
    this.entry.targets++;
  }
  disconnect() {
    this.entry.disconnected = true;
  }
}

afterEach(() => {
  globalThis.ResizeObserver = RealResizeObserver;
  observers.length = 0;
});

function fixture() {
  globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;
  const listeners = new Set<() => void>();
  let headReads = 0;
  let styleWrites = 0;
  const head = {
    get offsetHeight() {
      headReads++;
      return 44;
    },
  };
  const style: Record<string, string> = {};
  const fade = {
    style: new Proxy(style, {
      set(target, key, value) {
        styleWrites++;
        target[key as string] = value;
        return true;
      },
    }),
  } as unknown as HTMLElement;
  const scroller = {
    scrollLeft: 0,
    clientWidth: 1080,
    scrollWidth: COLUMNS * COLUMN_WIDTH,
    firstElementChild: {},
    querySelector: (selector: string) => (selector === "thead" ? head : null),
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  };
  const scroll = (left: number) => {
    scroller.scrollLeft = left;
    for (const listener of listeners) listener();
  };
  return {
    scroller,
    fade,
    style,
    listeners,
    scroll,
    counts: () => ({ headReads, styleWrites }),
  };
}

test("edge fade starts below the header and toggles only at the right edge", () => {
  const grid = fixture();
  const detach = attachScrollEdgeFade(grid.scroller as unknown as HTMLElement, grid.fade);
  expect(grid.style).toEqual({ top: "44px", opacity: "1" });
  expect(grid.listeners.size).toBe(1);
  expect(observers).toHaveLength(1);
  expect(observers[0].targets).toBe(2);
  grid.scroll(grid.scroller.scrollWidth - grid.scroller.clientWidth);
  expect(grid.style.opacity).toBe("0");
  grid.scroll(10);
  expect(grid.style.opacity).toBe("1");
  detach();
  expect(grid.listeners.size).toBe(0);
  expect(observers[0].disconnected).toBe(true);
});

test("400-column grid scroll and resize keep the edge fade off the layout and render path", async () => {
  const grid = fixture();
  const detach = attachScrollEdgeFade(grid.scroller as unknown as HTMLElement, grid.fade);
  const max = grid.scroller.scrollWidth - grid.scroller.clientWidth;
  const baseline = grid.counts();
  const handlerTimes: number[] = [];
  const timing = await measureScenario(() => {
    for (let index = 0; index < SCROLL_EVENTS; index++) {
      const start = performance.now();
      grid.scroll((index * 97) % (max + 1));
      handlerTimes.push(performance.now() - start);
    }
    for (let index = 0; index < 200; index++) {
      grid.scroller.clientWidth = 600 + (index % 5) * 200;
      observers[0].callback();
    }
  });
  const after = grid.counts();
  handlerTimes.sort((left, right) => left - right);
  const handlerMedianMs = handlerTimes[Math.floor(handlerTimes.length / 2)];
  const handlerP95Ms = handlerTimes[Math.ceil(handlerTimes.length * 0.95) - 1];
  const scrollEvents = SCROLL_EVENTS * (timing.runs + 2);
  const resizeCallbacks = 200 * (timing.runs + 2);
  detach();
  await reportScenario("grid-edge-fade", {
    ...timing,
    columns: COLUMNS,
    scrollEvents,
    resizeCallbacks,
    handlerMedianMs,
    handlerP95Ms,
    headerReads: after.headReads - baseline.headReads,
    styleWrites: after.styleWrites - baseline.styleWrites,
    scrollListeners: 1,
    resizeObservers: observers.length,
    reactRenders: 0,
    databaseRequests: 0,
  });
  expect(after.headReads - baseline.headReads).toBe(resizeCallbacks);
  expect(after.styleWrites - baseline.styleWrites).toBeLessThan(scrollEvents / 50);
  expect(observers).toHaveLength(1);
  expect(grid.listeners.size).toBe(0);
  expect(handlerP95Ms).toBeLessThan(0.05);
  expect(timing.p95Ms).toBeLessThan(40);
});
