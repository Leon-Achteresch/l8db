import { expect, test } from "bun:test";
import { Virtualizer } from "@tanstack/react-virtual";
import { measureScenario, reportScenario } from "../scripts/performance-report";
import { measureVirtualItem } from "../src/lib/virtual-item-measurement";

function instance(horizontal = false) {
  return new Virtualizer<Element, Element>({
    count: 100_000,
    horizontal,
    estimateSize: () => 64,
    getScrollElement: () => null,
    scrollToFn: () => undefined,
    observeElementRect: () => undefined,
    observeElementOffset: () => undefined,
  });
}

function item(index: number) {
  return {
    getAttribute: () => String(index),
    get offsetHeight() {
      throw new Error("Synchronous layout read");
    },
    get offsetWidth() {
      throw new Error("Synchronous layout read");
    },
  } as unknown as Element;
}

test("list mounts only estimate visible sizes and perform no synchronous layout reads", async () => {
  const virtualizer = instance();
  const elements = Array.from({ length: 40 }, (_, index) => item(50_000 + index));
  const timing = await measureScenario(() => {
    for (const element of elements)
      expect(measureVirtualItem(element, undefined, virtualizer)).toBe(64);
  });
  expect(virtualizer.itemSizeCache.size).toBe(0);
  expect(timing.p95Ms).toBeLessThan(10);
  await reportScenario("virtual-list-mount-measurement", {
    ...timing,
    sourceItems: 100_000,
    visibleItems: elements.length,
    synchronousLayoutReads: 0,
    retainedMeasurements: virtualizer.itemSizeCache.size,
  });
});

test("observer measurements update variable sizes and cached sizes survive remounts", () => {
  const vertical = instance();
  const element = item(5);
  const entry = {
    borderBoxSize: [{ blockSize: 83.6, inlineSize: 123.4 }],
  } as unknown as ResizeObserverEntry;
  expect(measureVirtualItem(element, entry, vertical)).toBe(84);
  vertical.itemSizeCache.set(5, 84);
  expect(measureVirtualItem(element, undefined, vertical)).toBe(84);
  expect(measureVirtualItem(element, entry, instance(true))).toBe(123);
});
