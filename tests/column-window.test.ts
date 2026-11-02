import { expect, test } from "bun:test";
import { assignColumnSlots, columnWindowRange } from "../src/lib/column-window";

test("column windows retain only the requested overscan and pinned columns", () => {
  const range = { startIndex: 4, endIndex: 10, overscan: 2, count: 51 };
  expect(columnWindowRange(range, [0])).toEqual([0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
});

test("column windows cover the viewport and retain pinned columns across a wide table", () => {
  for (const count of [21, 51, 121, 1001]) {
    for (let startIndex = 0; startIndex < count; startIndex++) {
      const endIndex = Math.min(startIndex + 6, count - 1);
      const indices = columnWindowRange({ startIndex, endIndex, overscan: 2, count }, [
        0,
        count - 1,
      ]);
      expect(indices).toContain(0);
      expect(indices).toContain(count - 1);
      for (let index = startIndex; index <= endIndex; index++) expect(indices).toContain(index);
      expect(indices).toEqual([...new Set(indices)].sort((a, b) => a - b));
      expect(indices.every((index) => index >= 0 && index < count)).toBe(true);
      expect(indices.length).toBeLessThanOrEqual(26);
    }
  }
});

test("Spalten behalten beim Verschieben ihren Zellplatz und neue Spalten übernehmen freie Plätze", () => {
  const first = assignColumnSlots([0, 4, 5, 6, 7], new Map());
  expect([...first]).toEqual([
    [0, 0],
    [4, 1],
    [5, 2],
    [6, 3],
    [7, 4],
  ]);
  const shifted = assignColumnSlots([0, 6, 7, 8, 9], first);
  expect([...shifted].sort((a, b) => a[0] - b[0])).toEqual([
    [0, 0],
    [6, 3],
    [7, 4],
    [8, 1],
    [9, 2],
  ]);
  const grown = assignColumnSlots([0, 6, 7, 8, 9, 10], shifted);
  expect(grown.get(10)).toBe(5);
  expect(new Set(grown.values()).size).toBe(grown.size);
});
