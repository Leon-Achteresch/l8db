import { expect, test } from "bun:test";
import type { Rect, Virtualizer } from "@tanstack/react-virtual";
import { measureScenario, reportScenario } from "../scripts/performance-report";
import { observeVirtualScrollRect } from "../src/lib/observe-virtual-scroll-rect";

function createViewport(useAnimationFrameWithResizeObserver = true) {
  const frames = new Map<number, FrameRequestCallback>();
  let frameId = 0;
  let frameRequests = 0;
  let maxPendingFrames = 0;
  let geometryReads = 0;
  let deliveries = 0;
  let lastRect: Rect | undefined;
  let notify: ResizeObserverCallback | undefined;
  let observedElement: Element | undefined;
  let observationOptions: ResizeObserverOptions | undefined;
  let disconnected = false;
  const readGeometry = () => {
    geometryReads++;
    throw new Error("Synchronous geometry read");
  };
  const element = {
    get offsetWidth() {
      return readGeometry();
    },
    get offsetHeight() {
      return readGeometry();
    },
    get clientWidth() {
      return readGeometry();
    },
    get clientHeight() {
      return readGeometry();
    },
    get scrollWidth() {
      return readGeometry();
    },
    get scrollHeight() {
      return readGeometry();
    },
    getBoundingClientRect: readGeometry,
    getClientRects: readGeometry,
  } as unknown as Element;
  class MockResizeObserver {
    constructor(callback: ResizeObserverCallback) {
      notify = callback;
    }

    observe(target: Element, options: ResizeObserverOptions) {
      observedElement = target;
      observationOptions = options;
    }

    disconnect() {
      disconnected = true;
    }
  }
  const targetWindow = {
    ResizeObserver: MockResizeObserver,
    requestAnimationFrame(callback: FrameRequestCallback) {
      frameRequests++;
      frames.set(++frameId, callback);
      maxPendingFrames = Math.max(maxPendingFrames, frames.size);
      return frameId;
    },
    cancelAnimationFrame(id: number) {
      frames.delete(id);
    },
  };
  const instance = {
    scrollElement: element,
    targetWindow,
    options: { useAnimationFrameWithResizeObserver },
  } as unknown as Virtualizer<Element, Element>;
  const cleanup = observeVirtualScrollRect(instance, (rect) => {
    deliveries++;
    lastRect = rect;
  });
  return {
    instance,
    cleanup,
    element,
    emit(entries: ResizeObserverEntry[]) {
      notify?.(entries, {} as ResizeObserver);
    },
    paint() {
      const callbacks = Array.from(frames.values());
      frames.clear();
      for (const callback of callbacks) callback(0);
    },
    pendingCallback: () => frames.values().next().value,
    stats: () => ({
      frameRequests,
      maxPendingFrames,
      pendingFrames: frames.size,
      geometryReads,
      deliveries,
      lastRect,
      observedElement,
      observationOptions,
      disconnected,
    }),
  };
}

function resize(width: number, height: number, borderBox = true) {
  return [
    {
      borderBoxSize: borderBox ? [{ inlineSize: width, blockSize: height }] : [],
      contentRect: { width, height },
    } as unknown as ResizeObserverEntry,
  ];
}

test("virtual viewport observes its first rounded border box without synchronous geometry reads", () => {
  const viewport = createViewport();
  expect(viewport.stats().observedElement).toBe(viewport.element);
  expect(viewport.stats().observationOptions).toEqual({ box: "border-box" });
  expect(viewport.stats().deliveries).toBe(0);
  expect(viewport.stats().pendingFrames).toBe(0);
  viewport.emit([]);
  expect(viewport.stats().pendingFrames).toBe(0);
  const entry = resize(479.6, 600.4);
  entry[0] = { ...entry[0], contentRect: { width: 999, height: 999 } } as ResizeObserverEntry;
  viewport.emit(entry);
  expect(viewport.stats().deliveries).toBe(0);
  expect(viewport.stats().pendingFrames).toBe(1);
  viewport.paint();
  expect(viewport.stats().lastRect).toEqual({ width: 480, height: 600 });
  expect(viewport.stats().deliveries).toBe(1);
  expect(viewport.stats().geometryReads).toBe(0);
  viewport.cleanup?.();
});

test("virtual viewport deduplicates rounded dimensions and delivers only the latest burst resize", () => {
  const viewport = createViewport();
  viewport.emit(resize(480.1, 600.1));
  viewport.emit(resize(480.2, 600.2));
  expect(viewport.stats().frameRequests).toBe(1);
  for (let index = 1; index <= 100; index++) viewport.emit(resize(480 + index, 600 + index));
  expect(viewport.stats().deliveries).toBe(0);
  expect(viewport.stats().maxPendingFrames).toBe(1);
  viewport.paint();
  expect(viewport.stats().lastRect).toEqual({ width: 580, height: 700 });
  expect(viewport.stats().deliveries).toBe(1);
  const requests = viewport.stats().frameRequests;
  viewport.emit(resize(580.4, 700.4));
  viewport.paint();
  viewport.paint();
  expect(viewport.stats().frameRequests).toBe(requests);
  expect(viewport.stats().deliveries).toBe(1);
  expect(viewport.stats().pendingFrames).toBe(0);
  viewport.cleanup?.();
});

test("virtual viewport teardown cancels pending delivery and rejects late observer and frame callbacks", () => {
  const viewport = createViewport();
  viewport.emit(resize(480, 600));
  const delayedFrame = viewport.pendingCallback();
  expect(delayedFrame).toBeDefined();
  viewport.cleanup?.();
  expect(viewport.stats().disconnected).toBe(true);
  expect(viewport.stats().pendingFrames).toBe(0);
  const requests = viewport.stats().frameRequests;
  viewport.emit(resize(700, 800));
  delayedFrame?.(0);
  viewport.paint();
  expect(viewport.stats().deliveries).toBe(0);
  expect(viewport.stats().frameRequests).toBe(requests);
  expect(viewport.stats().geometryReads).toBe(0);
});

test("virtual viewport immediate mode supports content-box fallback without scheduling frames", () => {
  const viewport = createViewport(false);
  viewport.emit(resize(479.6, 599.6, false));
  expect(viewport.stats().lastRect).toEqual({ width: 480, height: 600 });
  expect(viewport.stats().deliveries).toBe(1);
  viewport.emit(resize(480.2, 600.2, false));
  expect(viewport.stats().deliveries).toBe(1);
  viewport.emit(resize(640, 720));
  expect(viewport.stats().lastRect).toEqual({ width: 640, height: 720 });
  expect(viewport.stats().deliveries).toBe(2);
  expect(viewport.stats().frameRequests).toBe(0);
  expect(viewport.stats().geometryReads).toBe(0);
  viewport.cleanup?.();
  viewport.emit(resize(800, 900));
  expect(viewport.stats().deliveries).toBe(2);
});

test("virtual viewport unavailable elements, windows or ResizeObserver create no background work", () => {
  for (const values of [
    { scrollElement: null, targetWindow: {} },
    { scrollElement: {} as Element, targetWindow: null },
    { scrollElement: {} as Element, targetWindow: {} },
  ]) {
    const instance = {
      ...values,
      options: { useAnimationFrameWithResizeObserver: true },
    } as unknown as Virtualizer<Element, Element>;
    let deliveries = 0;
    expect(observeVirtualScrollRect(instance, () => deliveries++)).toBeUndefined();
    expect(deliveries).toBe(0);
  }
});

test("40 virtual viewports coalesce 80000 resize notifications into 800 deliveries with bounded idle state", async () => {
  const viewportCount = 40;
  const paints = 20;
  const notificationsPerPaint = 100;
  const viewports = Array.from({ length: viewportCount }, () => createViewport());
  const entries = Array.from({ length: paints * notificationsPerPaint }, (_, index) =>
    resize(800, 600 + index),
  );
  try {
    const timing = await measureScenario(() => {
      const deliveriesBefore = viewports.reduce(
        (sum, viewport) => sum + viewport.stats().deliveries,
        0,
      );
      for (let paint = 0; paint < paints; paint++) {
        for (const viewport of viewports) {
          for (let notification = 0; notification < notificationsPerPaint; notification++)
            viewport.emit(entries[paint * notificationsPerPaint + notification]);
        }
        for (const viewport of viewports) viewport.paint();
      }
      const deliveriesAfter = viewports.reduce(
        (sum, viewport) => sum + viewport.stats().deliveries,
        0,
      );
      expect(deliveriesAfter - deliveriesBefore).toBe(viewportCount * paints);
      for (const viewport of viewports) {
        expect(viewport.stats().lastRect).toEqual({ width: 800, height: 2599 });
        expect(viewport.stats().maxPendingFrames).toBeLessThanOrEqual(1);
        expect(viewport.stats().pendingFrames).toBe(0);
        expect(viewport.stats().geometryReads).toBe(0);
      }
    });
    const deliveries = viewports.reduce((sum, viewport) => sum + viewport.stats().deliveries, 0);
    const frameRequests = viewports.reduce(
      (sum, viewport) => sum + viewport.stats().frameRequests,
      0,
    );
    for (const viewport of viewports) {
      viewport.paint();
      viewport.paint();
    }
    expect(viewports.reduce((sum, viewport) => sum + viewport.stats().deliveries, 0)).toBe(
      deliveries,
    );
    expect(viewports.reduce((sum, viewport) => sum + viewport.stats().frameRequests, 0)).toBe(
      frameRequests,
    );
    expect(timing.p95Ms).toBeLessThan(100);
    await reportScenario("virtual-scroll-rect-resize-bursts", {
      ...timing,
      viewports: viewportCount,
      paintsPerRun: paints,
      notificationsPerRun: viewportCount * paints * notificationsPerPaint,
      deliveriesPerRun: viewportCount * paints,
      maxPendingFramesPerViewport: Math.max(
        ...viewports.map((viewport) => viewport.stats().maxPendingFrames),
      ),
      retainedPendingFrames: 0,
      synchronousGeometryReads: 0,
      idleDeliveries: 0,
      p95LimitMs: 100,
    });
  } finally {
    for (const viewport of viewports) viewport.cleanup?.();
  }
  for (const viewport of viewports) {
    expect(viewport.stats().disconnected).toBe(true);
    expect(viewport.stats().pendingFrames).toBe(0);
  }
});
