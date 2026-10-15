import { afterAll, beforeAll, expect, test } from "bun:test";
import { canonicalD, createMorph, type Morph } from "morphicons/dom";
import { appSidebarData } from "../src/features/sidebar/app-sidebar-data";

const items = appSidebarData.navMain;
const queue = new Map<number, FrameRequestCallback>();
let nextId = 1;
let clock = 0;
const original = {
  raf: globalThis.requestAnimationFrame,
  caf: globalThis.cancelAnimationFrame,
};

beforeAll(() => {
  globalThis.requestAnimationFrame = (callback) => {
    const id = nextId++;
    queue.set(id, callback);
    return id;
  };
  globalThis.cancelAnimationFrame = (id) => {
    queue.delete(id);
  };
});

afterAll(() => {
  globalThis.requestAnimationFrame = original.raf;
  globalThis.cancelAnimationFrame = original.caf;
});

function flush(limit = 1000) {
  let frames = 0;
  while (queue.size > 0 && frames < limit) {
    clock += 1000 / 60;
    const callbacks = [...queue.values()];
    queue.clear();
    for (const callback of callbacks) callback(clock);
    frames++;
  }
  return frames;
}

function percentile(values: number[], p: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

function mountRail() {
  const writes = { count: 0 };
  const paths = items.map(() => ({
    d: "",
    setAttribute(_name: string, value: string) {
      writes.count++;
      this.d = value;
    },
  }));
  const morphs: Morph[] = items.map((item, index) => createMorph(paths[index], item.icon));
  return { morphs, paths, writes };
}

test("every nav item has a distinct active icon that differs from its idle icon", () => {
  expect(items.length).toBeGreaterThanOrEqual(13);
  for (const item of items) expect(canonicalD(item.activeIcon)).not.toBe(canonicalD(item.icon));
  expect(new Set(items.map((item) => canonicalD(item.icon))).size).toBe(items.length);
});

test("switching the active area morphs within a bounded frame budget and goes idle", () => {
  const { morphs, paths, writes } = mountRail();
  flush();
  const switches = 400;
  const costs: number[] = [];
  const frames: number[] = [];
  let active = 0;
  for (let step = 0; step < switches; step++) {
    const next = (active + 1 + (step % 5)) % items.length;
    const started = performance.now();
    morphs[active].morphTo(items[active].icon);
    morphs[next].morphTo(items[next].activeIcon);
    costs.push(performance.now() - started);
    frames.push(flush());
    expect(queue.size).toBe(0);
    active = next;
  }
  for (const [index, item] of items.entries())
    expect(paths[index].d).toBe(canonicalD(index === active ? item.activeIcon : item.icon));
  const median = percentile(costs, 0.5);
  const p95 = percentile(costs, 0.95);
  const framesP95 = percentile(frames, 0.95);
  console.log(
    `nav morph: ${items.length} items, ${switches} switches, start median ${median.toFixed(3)} ms, p95 ${p95.toFixed(3)} ms, frames p95 ${framesP95}, max ${Math.max(...frames)}, path writes ${writes.count}`,
  );
  expect(median).toBeLessThan(0.5);
  expect(p95).toBeLessThan(2);
  expect(Math.max(...frames)).toBeLessThanOrEqual(35);
  expect(writes.count).toBeLessThanOrEqual(switches * 2 * 35 + items.length);
  for (const morph of morphs) morph.destroy();
});

test("rapid clicking interrupts in flight without piling up frames", () => {
  const { morphs, paths } = mountRail();
  flush();
  for (let burst = 0; burst < 50; burst++) {
    const index = burst % items.length;
    morphs[index].morphTo(items[index].activeIcon);
    flush(1);
    morphs[index].morphTo(items[index].icon);
  }
  expect(queue.size).toBeLessThanOrEqual(1);
  const frames = flush();
  expect(frames).toBeLessThanOrEqual(35);
  expect(queue.size).toBe(0);
  for (const [index, item] of items.entries()) expect(paths[index].d).toBe(canonicalD(item.icon));
  for (const morph of morphs) morph.destroy();
  expect(flush()).toBe(0);
});
