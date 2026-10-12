import { expect, test } from "bun:test";
import { reportScenario } from "../scripts/performance-report";
import { acquireHistoryModalBoundary } from "../src/lib/history-modal-boundary";
import { interactionPercentiles } from "./fixtures/perf-app-interactions";

class BoundaryNode {
  constructor(readonly parent: BoundaryNode | null = null) {}

  contains(target: BoundaryNode | null): boolean {
    return target === this || (!!target?.parent && this.contains(target.parent));
  }
}

async function withBoundaryFixture(
  run: (fixture: ReturnType<typeof boundaryFixture>) => Promise<void>,
) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "Node");
  Object.defineProperty(globalThis, "Node", { configurable: true, value: BoundaryNode });
  try {
    await run(boundaryFixture());
  } finally {
    if (previous) Object.defineProperty(globalThis, "Node", previous);
    else Reflect.deleteProperty(globalThis, "Node");
  }
}

function boundaryFixture() {
  const listeners = new Map<string, (event: Event) => void>();
  const frames = new Map<number, FrameRequestCallback>();
  let frameId = 0;
  const document = {
    defaultView: {
      requestAnimationFrame: (callback: FrameRequestCallback) => {
        const id = ++frameId;
        frames.set(id, callback);
        return id;
      },
      cancelAnimationFrame: (id: number) => frames.delete(id),
    },
    addEventListener: (type: string, listener: (event: Event) => void) =>
      listeners.set(type, listener),
    removeEventListener: (type: string) => listeners.delete(type),
  };
  const outside = new BoundaryNode();
  const outer = Object.assign(new BoundaryNode(), { ownerDocument: document });
  const inner = Object.assign(new BoundaryNode(outer), { ownerDocument: document });
  const dispatch = (type: string, target: BoundaryNode = outside) => {
    const event = new Event(type, { cancelable: true, bubbles: true });
    Object.defineProperty(event, "target", { value: target });
    listeners.get(type)?.(event);
    return event.defaultPrevented;
  };
  const flush = () => {
    const callbacks = [...frames.values()];
    frames.clear();
    for (const callback of callbacks) callback(performance.now());
  };
  return { outer, inner, listeners, frames, dispatch, flush };
}

test("history modal boundaries consume completed gestures and preserve the remaining scope", async () => {
  await withBoundaryFixture(async ({ outer, inner, listeners, frames, dispatch, flush }) => {
    let outerCloses = 0;
    let innerCloses = 0;
    const releaseOuter = acquireHistoryModalBoundary(
      outer as unknown as HTMLElement,
      () => outerCloses++,
    );
    const releaseInner = acquireHistoryModalBoundary(
      inner as unknown as HTMLElement,
      () => innerCloses++,
    );
    expect(listeners.size).toBe(28);
    expect(dispatch("pointerdown", inner)).toBe(false);
    expect(dispatch("click", outer)).toBe(true);
    expect(innerCloses).toBe(1);
    expect(outerCloses).toBe(0);
    releaseInner();
    expect(listeners.size).toBe(28);
    expect(dispatch("pointerdown")).toBe(true);
    expect(dispatch("contextmenu")).toBe(true);
    expect(outerCloses).toBe(0);
    expect(dispatch("pointerup")).toBe(true);
    expect(frames.size).toBe(1);
    expect(dispatch("auxclick")).toBe(true);
    expect(outerCloses).toBe(0);
    flush();
    expect(outerCloses).toBe(1);
    releaseOuter();
    releaseOuter();
    expect(listeners.size).toBe(0);
    expect(frames.size).toBe(0);
  });
});

test("history modal boundaries cancel pending dismissal and idle without retained listeners", async () => {
  await withBoundaryFixture(async ({ outer, listeners, frames, dispatch, flush }) => {
    let closes = 0;
    const release = acquireHistoryModalBoundary(outer as unknown as HTMLElement, () => closes++);
    dispatch("pointerdown");
    dispatch("contextmenu");
    dispatch("pointerup");
    expect(frames.size).toBe(1);
    release();
    flush();
    expect(closes).toBe(0);
    expect(frames.size).toBe(0);
    expect(listeners.size).toBe(0);
    expect(dispatch("click")).toBe(false);
    expect(dispatch("wheel")).toBe(false);
  });
});

test("history modal boundaries clear outside gestures released or cancelled inside", async () => {
  await withBoundaryFixture(async ({ outer, listeners, frames, dispatch, flush }) => {
    for (const type of ["pointerup", "pointercancel"]) {
      let closes = 0;
      const release = acquireHistoryModalBoundary(outer as unknown as HTMLElement, () => closes++);
      expect(dispatch("pointerdown")).toBe(true);
      expect(dispatch(type, outer)).toBe(false);
      expect(dispatch("contextmenu")).toBe(true);
      expect(closes).toBe(1);
      expect(frames.size).toBe(0);
      release();
      flush();
      expect(closes).toBe(1);
      expect(listeners.size).toBe(0);
    }
  });
});

test("history modal boundaries keep 1000 gesture and cancellation cycles bounded", async () => {
  await withBoundaryFixture(async ({ outer, listeners, frames, dispatch, flush }) => {
    const samples: number[] = [];
    let peakListeners = 0;
    let peakFrames = 0;
    let delivered = 0;
    for (let turn = 0; turn < 11; turn++) {
      delivered = 0;
      const started = performance.now();
      for (let index = 0; index < 1000; index++) {
        const release = acquireHistoryModalBoundary(
          outer as unknown as HTMLElement,
          () => delivered++,
        );
        peakListeners = Math.max(peakListeners, listeners.size);
        dispatch("pointerdown");
        dispatch("contextmenu");
        dispatch("pointerup", index % 2 === 0 ? outer : undefined);
        peakFrames = Math.max(peakFrames, frames.size);
        if (index % 2 === 0) flush();
        release();
        flush();
      }
      if (turn > 1) samples.push(performance.now() - started);
    }
    const latency = interactionPercentiles(samples);
    await reportScenario("history-modal-boundary-cycles", {
      workload: {
        cycles: 1000,
        eventsPerCycle: 3,
        cancelledDismissals: 500,
        releaseTargets: "alternating inside and outside",
      },
      measurement: "mock document listener and animation-frame lifecycle",
      latency,
      peakListeners,
      peakFrames,
      delivered,
      retainedListeners: listeners.size,
      idleFrames: frames.size,
    });
    expect(delivered).toBe(500);
    expect(peakListeners).toBe(28);
    expect(peakFrames).toBe(1);
    expect(listeners.size).toBe(0);
    expect(frames.size).toBe(0);
    expect(latency.p95Ms).toBeLessThanOrEqual(50);
  });
});
