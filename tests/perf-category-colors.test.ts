import { expect, test } from "bun:test";
import { measureScenario, reportScenario } from "../scripts/performance-report";
import { CATEGORY_COLORS, categoryColorIndex, categoryColorMap } from "../src/lib/grid-cell-format";

test("100,000 categorical cells keep color selection fast with bounded output", async () => {
  const values = ["ABG", "ANG", "AKT", "INA", "pending", "shipped", "open", "x".repeat(24)];
  const cells = 100_000;
  const column = Array.from({ length: cells }, (_, cell) => values[cell % values.length]);
  const counts = new Uint32Array(CATEGORY_COLORS);
  let colors = new Map<string, number>();
  const timing = await measureScenario(() => {
    counts.fill(0);
    colors = categoryColorMap(column);
    for (let cell = 0; cell < cells; cell++) {
      counts[colors.get(column[cell]) ?? categoryColorIndex(column[cell])]++;
    }
  });
  expect(counts.reduce((sum, count) => sum + count, 0)).toBe(cells);
  expect(colors.size).toBe(values.length);
  expect(counts.every((count) => count === cells / values.length)).toBe(true);
  expect(counts.byteLength).toBe(CATEGORY_COLORS * 4);
  expect(timing.p95Ms).toBeLessThan(20);
  await reportScenario("category-colors", {
    ...timing,
    cells,
    maxValueLength: 24,
    outputBytes: counts.byteLength,
    databaseRequests: 0,
    limits: { p95Ms: 20, outputBytes: CATEGORY_COLORS * 4 },
  });
});
