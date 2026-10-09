import { expect, test } from "bun:test";
import { measureScenario, reportScenario } from "../scripts/performance-report";
import { createGridWindowRange } from "../src/lib/grid-window-range";

test("buffered grid windows cover both scroll directions, pinned columns, and result edges", () => {
  for (const count of [1, 21, 121, 100_000]) {
    for (const [before, after, block] of [
      [2, 8, 8],
      [8, 2, 8],
      [2, 8, 4],
      [8, 2, 4],
      [2, 4, 4],
      [4, 2, 4],
      [4, 7, 4],
      [7, 4, 4],
      [1, 4, 2],
    ]) {
      const range = createGridWindowRange(before, after, block, [0, count - 1]);
      for (const startIndex of [0, 1, 8, Math.floor(count / 2), count - 1]) {
        if (startIndex >= count) continue;
        const endIndex = Math.min(startIndex + 19, count - 1);
        const indices = range({ startIndex, endIndex, overscan: 0, count });
        expect(indices).toContain(0);
        expect(indices).toContain(count - 1);
        expect(indices).toEqual([...new Set(indices)].sort((a, b) => a - b));
        expect(indices.every((index) => index >= 0 && index < count)).toBe(true);
        for (let index = startIndex; index <= endIndex; index++) expect(indices).toContain(index);
        expect(indices.length).toBeLessThanOrEqual(47);
      }
    }
  }
});

test("buffered grid windows invalidate changed counts and preserve stable forward and reverse ranges", () => {
  for (const [before, after, block] of [
    [2, 8, 8],
    [8, 2, 8],
    [2, 8, 4],
    [8, 2, 4],
    [2, 4, 4],
    [4, 2, 4],
    [4, 7, 4],
    [7, 4, 4],
    [1, 4, 2],
  ]) {
    const windowRange = createGridWindowRange(before, after, block, [0, 120]);
    const range = { startIndex: 16, endIndex: 31, overscan: 0, count: 100_000 };
    const initial = windowRange(range);
    expect(windowRange({ ...range })).toBe(initial);
    for (let startIndex = 16; startIndex >= 0; startIndex--) {
      const current = windowRange({ ...range, startIndex, endIndex: startIndex + 15 });
      for (let index = startIndex; index <= startIndex + 15; index++)
        expect(current).toContain(index);
      expect(current.length).toBeLessThanOrEqual(43);
    }
    const shrunk = windowRange({ startIndex: 0, endIndex: 4, overscan: 0, count: 5 });
    expect(shrunk).toEqual([0, 1, 2, 3, 4]);
    expect(windowRange({ startIndex: 0, endIndex: 4, overscan: 0, count: 5 })).toBe(shrunk);
    expect(windowRange({ startIndex: 0, endIndex: 0, overscan: 0, count: 0 })).toEqual([]);
    const grown = windowRange(range);
    expect(grown).toEqual(initial);
    expect(grown).not.toBe(initial);
  }
});

test("partial column edges reuse their buffered window while large viewport shrink releases extra indices", () => {
  const windowRange = createGridWindowRange(1, 4, 2, [0]);
  const initial = windowRange({ startIndex: 10, endIndex: 19, overscan: 0, count: 100_000 });
  for (const [startIndex, endIndex] of [
    [10, 18],
    [10, 17],
    [11, 19],
    [12, 19],
    [10, 19],
  ])
    expect(windowRange({ startIndex, endIndex, overscan: 0, count: 100_000 })).toBe(initial);
  const advanced = windowRange({ startIndex: 12, endIndex: 20, overscan: 0, count: 100_000 });
  expect(advanced).not.toBe(initial);
  for (let index = 11; index <= 24; index++) expect(advanced).toContain(index);
  const shrunk = windowRange({ startIndex: 14, endIndex: 14, overscan: 0, count: 100_000 });
  expect(shrunk).not.toBe(advanced);
  expect(shrunk.length).toBeLessThanOrEqual(9);
});

test("5,000 viewport updates over 100,000 rows reuse bounded index windows between boundaries", async () => {
  let changedWindows = 0;
  let largestWindow = 0;
  const timing = await measureScenario(() => {
    const windowRange = createGridWindowRange(2, 8, 8);
    let previous: number[] | undefined;
    changedWindows = 0;
    largestWindow = 0;
    for (let startIndex = 50_000; startIndex < 55_000; startIndex++) {
      const indices = windowRange({
        startIndex,
        endIndex: startIndex + 19,
        overscan: 0,
        count: 100_000,
      });
      if (indices !== previous) changedWindows++;
      previous = indices;
      largestWindow = Math.max(largestWindow, indices.length);
    }
    expect(changedWindows).toBeLessThanOrEqual(626);
    expect(largestWindow).toBeLessThanOrEqual(40);
    const idle = { startIndex: 54_999, endIndex: 55_018, overscan: 0, count: 100_000 };
    for (let tick = 0; tick < 1_000; tick++) expect(windowRange(idle)).toBe(previous);
  });
  await reportScenario("grid-buffered-windows", {
    ...timing,
    sourceRows: 100_000,
    viewportUpdates: 5_000,
    changedWindows,
    largestWindow,
    retainedWindows: 1,
    idleAllocations: 0,
    databaseRequests: 0,
  });
  expect(timing.p95Ms).toBeLessThan(20);
});

test("5,000 pixel scroll updates keep partially visible column boundaries and allocations bounded", async () => {
  let changedWindows = 0;
  let largestWindow = 0;
  const timing = await measureScenario(() => {
    const windowRange = createGridWindowRange(1, 4, 2, [0]);
    let previous: number[] | undefined;
    changedWindows = 0;
    largestWindow = 0;
    for (let update = 0; update < 5_000; update++) {
      const offset = 50_000 + update * 30;
      const startIndex = Math.floor(offset / 160);
      const endIndex = Math.floor((offset + 1_176) / 160);
      const indices = windowRange({ startIndex, endIndex, overscan: 0, count: 100_000 });
      if (indices !== previous) changedWindows++;
      previous = indices;
      largestWindow = Math.max(largestWindow, indices.length);
      expect(indices.includes(startIndex) && indices.includes(endIndex)).toBe(true);
    }
    expect(changedWindows).toBeLessThanOrEqual(626);
    expect(largestWindow).toBeLessThanOrEqual(17);
  });
  expect(timing.p95Ms).toBeLessThan(20);
  await reportScenario("grid-partial-column-windows", {
    ...timing,
    sourceColumns: 100_000,
    viewportUpdates: 5_000,
    columnWidth: 160,
    viewportWidth: 1_176,
    pixelStep: 30,
    changedWindows,
    largestWindow,
    retainedWindows: 1,
    databaseRequests: 0,
  });
});
