import { expect, test } from "bun:test";
import { columnWindowRange } from "../src/lib/column-window";

test("scrolling inside a column batch retains the rendered columns", () => {
  const range = { startIndex: 4, endIndex: 10, overscan: 2, count: 51 };
  expect(columnWindowRange(range, [0])).toEqual(
    columnWindowRange({ ...range, startIndex: 5, endIndex: 11 }, [0]),
  );
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
